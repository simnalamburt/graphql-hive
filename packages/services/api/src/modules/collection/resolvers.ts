import * as zod from 'zod';
import { fromZodError } from 'zod-validation-error';
import { TargetAccessScope } from '../auth/providers/scopes';
import { CollectionModule } from './__generated__/types';
import { CollectionProvider } from './providers/collection.provider';

export const resolvers: CollectionModule.Resolvers = {
  Mutation: {
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
