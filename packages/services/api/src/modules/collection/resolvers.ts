import * as zod from 'zod';
import { fromZodError } from 'zod-validation-error';
import { TargetAccessScope } from '../auth/providers/scopes';
import { CollectionModule } from './__generated__/types';
import { CollectionProvider } from './providers/collection.provider';

const MAX_INPUT_LENGTH = 5000;

// The following validates the length and the validity of the JSON object incoming as string.
const inputObjectSchema = zod
  .string()
  .max(MAX_INPUT_LENGTH)
  .optional()
  .nullable()
  .refine(v => {
    if (!v) {
      return true;
    }

    try {
      JSON.parse(v);
      return true;
    } catch {
      return false;
    }
  });

const OperationValidationInputModel = zod
  .object({
    collectionId: zod.string(),
    name: zod.string().min(1).max(100),
    query: zod.string().min(1).max(MAX_INPUT_LENGTH),
    variables: inputObjectSchema,
    headers: inputObjectSchema,
  })
  .partial()
  .passthrough();

export const resolvers: CollectionModule.Resolvers = {
  Mutation: {
    async deleteDocumentCollection(_, { selector, id }, { injector }) {
      const target = await validateTargetAccess(
        injector,
        selector,
        TargetAccessScope.REGISTRY_WRITE,
      );
      await injector.get(CollectionProvider).deleteCollection(id);

      return {
        ok: {
          __typename: 'DeleteDocumentCollectionOkPayload',
          deletedId: id,
          updatedTarget: target,
        },
      };
    },
    async createOperationInDocumentCollection(_, { selector, input }, { injector }) {
      try {
        OperationValidationInputModel.parse(input);
        const target = await validateTargetAccess(
          injector,
          selector,
          TargetAccessScope.REGISTRY_WRITE,
        );
        const result = await injector.get(CollectionProvider).createOperation(input);
        const collection = await injector
          .get(CollectionProvider)
          .getCollection(result.documentCollectionId);

        if (!result || !collection) {
          return {
            error: {
              __typename: 'ModifyDocumentCollectionError',
              message: 'Failed to locate a document collection',
            },
          };
        }

        return {
          ok: {
            __typename: 'ModifyDocumentCollectionOperationOkPayload',
            operation: result,
            updatedTarget: target,
            collection,
          },
        };
      } catch (e) {
        if (e instanceof zod.ZodError) {
          return {
            error: {
              __typename: 'ModifyDocumentCollectionError',
              message: fromZodError(e).message,
            },
          };
        }

        throw e;
      }
    },
    async updateOperationInDocumentCollection(_, { selector, input }, { injector }) {
      try {
        OperationValidationInputModel.parse(input);
        const target = await validateTargetAccess(
          injector,
          selector,
          TargetAccessScope.REGISTRY_WRITE,
        );
        const result = await injector.get(CollectionProvider).updateOperation(input);

        if (!result) {
          return {
            error: {
              __typename: 'ModifyDocumentCollectionError',
              message: 'Failed to locate a document collection',
            },
          };
        }

        const collection = await injector
          .get(CollectionProvider)
          .getCollection(result.documentCollectionId);

        return {
          ok: {
            __typename: 'ModifyDocumentCollectionOperationOkPayload',
            operation: result,
            updatedTarget: target,
            collection: collection!,
          },
        };
      } catch (e) {
        if (e instanceof zod.ZodError) {
          return {
            error: {
              __typename: 'ModifyDocumentCollectionError',
              message: fromZodError(e).message,
            },
          };
        }

        throw e;
      }
    },
    async deleteOperationInDocumentCollection(_, { selector, id }, { injector }) {
      const target = await validateTargetAccess(
        injector,
        selector,
        TargetAccessScope.REGISTRY_WRITE,
      );
      const operation = await injector.get(CollectionProvider).getOperation(id);

      if (!operation) {
        return {
          error: {
            __typename: 'ModifyDocumentCollectionError',
            message: 'Failed to locate a operation',
          },
        };
      }

      const collection = await injector
        .get(CollectionProvider)
        .getCollection(operation.documentCollectionId);
      await injector.get(CollectionProvider).deleteOperation(id);

      return {
        ok: {
          __typename: 'DeleteDocumentCollectionOperationOkPayload',
          deletedId: id,
          updatedTarget: target,
          updatedCollection: collection!,
        },
      };
    },
  },
};
