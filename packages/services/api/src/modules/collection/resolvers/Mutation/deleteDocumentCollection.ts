import { CollectionProvider } from '../../providers/collection.provider';
import { validateTargetAccess } from '../../validateTargetAccess';
import { TargetAccessScope, type MutationResolvers } from './../../../../__generated__/types.next';

export const deleteDocumentCollection: NonNullable<
  MutationResolvers['deleteDocumentCollection']
> = async (_, { selector, id }, { injector }) => {
  const target = await validateTargetAccess(injector, selector, TargetAccessScope.REGISTRY_WRITE);
  await injector.get(CollectionProvider).deleteCollection(id);

  return {
    ok: {
      __typename: 'DeleteDocumentCollectionOkPayload',
      deletedId: id,
      updatedTarget: target,
    },
  };
};
