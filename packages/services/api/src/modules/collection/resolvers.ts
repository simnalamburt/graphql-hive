import { TargetAccessScope } from '../auth/providers/scopes';
import { CollectionModule } from './__generated__/types';
import { CollectionProvider } from './providers/collection.provider';

export const resolvers: CollectionModule.Resolvers = {
  Mutation: {
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
