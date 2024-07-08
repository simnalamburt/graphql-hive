import got from 'got';
import {
  buildSchema,
  GraphQLFieldMap,
  GraphQLSchema,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isIntrospectionType,
  isObjectType,
  isScalarType,
  isUnionType,
} from 'graphql';
// import pLimit from 'p-limit';
import { CommonQueryMethods, createPool, sql } from 'slonik';
import { createConnectionString } from '../connection-string.js';
import { env } from './environment.js';

function log(...args: any[]) {
  console.log(new Date().toLocaleString(), '| INFO  |', ...args);
}

function logError(...args: any[]) {
  console.error(new Date().toLocaleString(), '| ERROR |', ...args);
}

async function main() {
  const { postgres } = env;
  const poolSize = 5;
  // const limit = pLimit(poolSize);
  const startedAt = Date.now();

  log('Starting schema cleanup tracker backfill');
  const slonik = await createPool(createConnectionString(postgres), {
    // 30 seconds timeout per statement
    statementTimeout: 30 * 1000,
    maximumPoolSize: poolSize,
  });

  const schemaVersionsTotal = await slonik.oneFirst<number>(sql`
    SELECT count(*) as total FROM schema_versions
  `);
  log(`Found ${schemaVersionsTotal} schema versions`);

  // if (schemaVersionsTotal > 1000) {
  //   console.warn(
  //     `[WARN] There are more than 1000 schema versions (${schemaVersionsTotal}). Skipping a data backfill.`,
  //   );
  // }

  // return;

  // List all coordinates from the latest composable schema.
  // Go from latest to oldest schema version.
  // Stop when the list of coordinates is empty.

  // Fetch targets
  const targetIds = await slonik.manyFirst<string>(sql`
    SELECT id FROM targets
  `);

  log(`Found ${targetIds.length} targets`);

  let i = 0;
  for await (const targetId of targetIds) {
    log(`Processing target (${i++}/${targetIds.length}) - ${targetId}`);

    const latestSchema = await slonik.maybeOne<{
      id: string;
      created_at: number;
      is_composable: boolean;
      sdl?: string;
      previous_schema_version_id?: string;
    }>(sql`
      SELECT
        id,
        created_at,
        is_composable,
        previous_schema_version_id,
        composite_schema_sdl as sdl
      FROM schema_versions
      WHERE target_id = ${targetId} AND is_composable = true
      ORDER BY created_at DESC
      LIMIT 1
    `);

    if (!latestSchema) {
      log('[SKIPPING] No latest composable schema found for target %s', targetId);
      continue;
    }

    if (!latestSchema.sdl) {
      console.warn(
        `[SKIPPING] No latest, composable schema with non-empty sdl found for target ${targetId}.`,
      );
      continue;
    }

    const schema = buildSchema(latestSchema.sdl, {
      assumeValid: true,
      assumeValidSDL: true,
    });
    const targetCoordinates = getSchemaCoordinates(schema);

    // The idea here is to
    // 1. start from the latest composable version.
    // 2. create a list of coordinates that are in the latest version, all and deprecated.
    // 3. navigate to the previous version and compare the coordinates.
    // 4. if a coordinate is added, upsert it into the schema_cleanup_tracker and remove it from the list.
    // 5. if a coordinate is deprecated, upsert it into the schema_cleanup_tracker and remove it from the list of deprecated coordinates.
    // 6. if the list of coordinates is empty, stop the process.
    // 7. if the previous version is not composable, skip it and continue with the next previous version.
    // 8. if the previous version is not found, insert all remaining coordinates and stop the process. This step might create incorrect dates!
    await processVersion(1, slonik, targetCoordinates, targetId, {
      schema,
      versionId: latestSchema.id,
      createdAt: latestSchema.created_at,
      previousVersionId: latestSchema.previous_schema_version_id ?? null,
    });
  }

  log(`Finished in ${Math.round((Date.now() - startedAt) / 1000)}s`);
}

type SchemaCoordinatesDiffResult = {
  /**
   * Coordinates that are in incoming but not in existing (including deprecated ones)
   */
  added: Set<string>;
  /**
   * Coordinates that are in existing but not in incoming (including deprecated ones)
   */
  deleted: Set<string>;
  /**
   * Coordinates that are deprecated in incoming, but were not deprecated in existing or non-existent
   */
  deprecated: Set<string>;
  /**
   * Coordinates that exists in incoming and are not deprecated in incoming, but were deprecated in existing
   */
  undeprecated: Set<string>;
};

function diffSchemaCoordinates(
  existingSchema: GraphQLSchema,
  incomingSchema: GraphQLSchema,
): SchemaCoordinatesDiffResult {
  const before = getSchemaCoordinates(existingSchema);
  const after = getSchemaCoordinates(incomingSchema);

  const added = after.coordinates.difference(before.coordinates);
  const deleted = before.coordinates.difference(after.coordinates);
  const deprecated = after.deprecated.difference(before.deprecated);
  const undeprecated = before.deprecated.intersection(after.coordinates);

  return {
    added,
    deleted,
    deprecated,
    undeprecated,
  };
}

function getSchemaCoordinates(schema: GraphQLSchema): {
  coordinates: Set<string>;
  deprecated: Set<string>;
} {
  const coordinates = new Set<string>();
  const deprecated = new Set<string>();

  const typeMap = schema.getTypeMap();

  for (const typeName in typeMap) {
    const typeDefinition = typeMap[typeName];

    if (isIntrospectionType(typeDefinition)) {
      continue;
    }

    coordinates.add(typeName);

    if (isObjectType(typeDefinition) || isInterfaceType(typeDefinition)) {
      visitSchemaCoordinatesOfGraphQLFieldMap(
        typeName,
        typeDefinition.getFields(),
        coordinates,
        deprecated,
      );
    } else if (isInputObjectType(typeDefinition)) {
      const fieldMap = typeDefinition.getFields();
      for (const fieldName in fieldMap) {
        const fieldDefinition = fieldMap[fieldName];

        coordinates.add(`${typeName}.${fieldName}`);
        if (fieldDefinition.deprecationReason) {
          deprecated.add(`${typeName}.${fieldName}`);
        }
      }
    } else if (isUnionType(typeDefinition)) {
      coordinates.add(typeName);
      for (const member of typeDefinition.getTypes()) {
        coordinates.add(`${typeName}.${member.name}`);
      }
    } else if (isEnumType(typeDefinition)) {
      const values = typeDefinition.getValues();
      for (const value of values) {
        coordinates.add(`${typeName}.${value.name}`);
        if (value.deprecationReason) {
          deprecated.add(`${typeName}.${value.name}`);
        }
      }
    } else if (isScalarType(typeDefinition)) {
      coordinates.add(typeName);
    } else {
      throw new Error(`Unsupported type kind ${typeName}`);
    }
  }

  return {
    coordinates,
    deprecated,
  };
}

function visitSchemaCoordinatesOfGraphQLFieldMap(
  typeName: string,
  fieldMap: GraphQLFieldMap<any, any>,
  coordinates: Set<string>,
  deprecated: Set<string>,
) {
  for (const fieldName in fieldMap) {
    const fieldDefinition = fieldMap[fieldName];

    coordinates.add(`${typeName}.${fieldName}`);
    if (fieldDefinition.deprecationReason) {
      deprecated.add(`${typeName}.${fieldName}`);
    }

    for (const arg of fieldDefinition.args) {
      coordinates.add(`${typeName}.${fieldName}.${arg.name}`);
      if (arg.deprecationReason) {
        deprecated.add(`${typeName}.${fieldName}.${arg.name}`);
      }
    }
  }
}

async function insertRemainingCoordinates(
  connection: CommonQueryMethods,
  targetId: string,
  targetCoordinates: {
    coordinates: Set<string>;
    deprecated: Set<string>;
  },
  versionId: string,
  createdAt: number,
) {
  if (targetCoordinates.coordinates.size === 0) {
    return;
  }

  const pgDate = new Date(createdAt).toISOString();

  // Deprecated only the coordinates that are still in the queue
  const remainingDeprecated = targetCoordinates.deprecated.intersection(
    targetCoordinates.coordinates,
  );

  log(`Adding remaining ${targetCoordinates.coordinates.size} coordinates for target ${targetId}`);
  await connection.query(sql`
      INSERT INTO schema_cleanup_tracker
      ( target_id, coordinate, created_at, created_in_version_id )
      SELECT * FROM ${sql.unnest(
        Array.from(targetCoordinates.coordinates).map(coordinate => [
          targetId,
          coordinate,
          pgDate,
          versionId,
        ]),
        ['uuid', 'text', 'date', 'uuid'],
      )}
    `);

  if (remainingDeprecated.size) {
    log(`Deprecating remaining ${remainingDeprecated.size} coordinates for target ${targetId}`);
    await connection.query(sql`
      INSERT INTO schema_cleanup_tracker
      ( target_id, coordinate, created_at, created_in_version_id, deprecated_at, deprecated_in_version_id )
      SELECT * FROM ${sql.unnest(
        Array.from(remainingDeprecated).map(coordinate => [
          targetId,
          coordinate,
          pgDate,
          versionId,
          pgDate,
          versionId,
        ]),
        ['uuid', 'text', 'date', 'uuid', 'date', 'uuid'],
      )}
      ON CONFLICT (target_id, coordinate)
      DO UPDATE SET deprecated_at = ${pgDate}, deprecated_in_version_id = ${versionId}
    `);
    // there will be a conflict, because we are going from deprecated to added order.
  }
}

async function processVersion(
  depth: number,
  connection: CommonQueryMethods,
  targetCoordinates: {
    coordinates: Set<string>;
    deprecated: Set<string>;
  },
  targetId: string,
  after: {
    schema: GraphQLSchema;
    versionId: string;
    createdAt: number;
    previousVersionId: string | null;
  },
): Promise<void> {
  log(`Processing target %s at depth %s - version`, targetId, depth, after.versionId);
  const previousVersionId = after.previousVersionId;
  if (!previousVersionId) {
    // Seems like there is no previous version.
    log(`[END] No previous version found. Inserting all remaining coordinates for ${targetId}`);
    await insertRemainingCoordinates(
      connection,
      targetId,
      targetCoordinates,
      after.versionId,
      after.createdAt,
    );
    return;
  }

  const versionBefore = await connection.maybeOne<{
    id: string;
    sdl?: string;
    previous_schema_version_id?: string;
    created_at: number;
    is_composable: boolean;
  }>(sql`
    SELECT
      id,
      composite_schema_sdl as sdl,
      previous_schema_version_id,
      created_at,
      is_composable
    FROM schema_versions
    WHERE id = ${previousVersionId} AND target_id = ${targetId}
  `);

  if (!versionBefore) {
    logError(
      `No schema found for version ${previousVersionId}. Inserting all remaining coordinates for ${targetId}`,
    );
    await insertRemainingCoordinates(
      connection,
      targetId,
      targetCoordinates,
      after.versionId,
      after.createdAt,
    );
    return;
  }

  if (!versionBefore.is_composable) {
    // Skip non-composable schemas and continue with the previous version.
    return processVersion(depth + 1, connection, targetCoordinates, targetId, {
      schema: after.schema,
      versionId: after.versionId,
      createdAt: after.createdAt,
      previousVersionId: versionBefore.previous_schema_version_id ?? null,
    });
  }

  if (!versionBefore.sdl) {
    logError(
      `No SDL found for version ${previousVersionId}. Inserting all remaining coordinates for ${targetId}`,
    );
    await insertRemainingCoordinates(
      connection,
      targetId,
      targetCoordinates,
      after.versionId,
      after.createdAt,
    );
    return;
  }

  const before: {
    schema: GraphQLSchema;
    versionId: string;
    createdAt: number;
    previousVersionId: string | null;
  } = {
    schema: buildSchema(versionBefore.sdl, {
      assumeValid: true,
      assumeValidSDL: true,
    }),
    versionId: versionBefore.id,
    createdAt: versionBefore.created_at,
    previousVersionId: versionBefore.previous_schema_version_id ?? null,
  };
  const diff = diffSchemaCoordinates(before.schema, after.schema);

  // We don't have to track undeprecated or deleted coordinates
  // as we only want to represent the current state of the schema.
  const added: string[] = [];
  const deprecated: string[] = [];
  const deleteAdded = new Set<string>();
  const deleteDeprecated = new Set<string>();

  for (const coordinate of diff.added) {
    if (targetCoordinates.coordinates.has(coordinate)) {
      added.push(coordinate);
      // We found a schema version that added a coordinate, so we don't have to look further
      deleteAdded.add(coordinate);
    }
  }

  for (const coordinate of diff.deprecated) {
    if (targetCoordinates.coordinates.has(coordinate)) {
      deprecated.push(coordinate);
      deleteDeprecated.add(coordinate);
    }
  }

  const datePG = new Date(after.createdAt).toISOString();

  if (added.length) {
    log(`Adding ${added.length} coordinates for target ${targetId}`);
    await connection.query(sql`
      INSERT INTO schema_cleanup_tracker
      ( target_id, coordinate, created_at, created_in_version_id )
      SELECT * FROM ${sql.unnest(
        added.map(coordinate => [targetId, coordinate, datePG, after.versionId]),
        ['uuid', 'text', 'date', 'uuid'],
      )}
    `);
  }

  if (deprecated.length) {
    log(`deprecating ${deprecated.length} coordinates for target ${targetId}`);
    await connection.query(sql`
      INSERT INTO schema_cleanup_tracker
      ( target_id, coordinate, created_at, created_in_version_id, deprecated_at, deprecated_in_version_id )
      SELECT * FROM ${sql.unnest(
        added.map(coordinate => [
          targetId,
          coordinate,
          datePG,
          after.versionId,
          datePG,
          after.versionId,
        ]),
        ['uuid', 'text', 'date', 'uuid', 'date', 'uuid'],
      )}
      ON CONFLICT (target_id, coordinate)
      DO UPDATE SET deprecated_at = ${datePG}, deprecated_in_version_id = ${after.versionId}
    `);
    // there will be a conflict, because we are going from deprecated to added order.
  }

  // Remove coordinates that were added in this diff.
  // We don't need to look for them in previous versions.
  for (const coordinate of deleteAdded) {
    targetCoordinates.coordinates.delete(coordinate);
  }
  // Remove coordinates that were deprecated in this diff.
  // To avoid marking them as deprecated later on.
  for (const coordinate of deleteDeprecated) {
    targetCoordinates.deprecated.delete(coordinate);
  }

  if (deleteAdded.size) {
    log(`Deleted ${deleteAdded.size} coordinates from the stack`);
    log(`Coordinates in queue: ${targetCoordinates.coordinates.size}`);
  }

  return processVersion(depth + 1, connection, targetCoordinates, targetId, before);
}

main();
