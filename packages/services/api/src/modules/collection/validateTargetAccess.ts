import type { Injector } from 'graphql-modules';
import type { TargetSelectorInput } from '../../__generated__/types.next';
import { AuthManager } from '../auth/providers/auth-manager';
import { TargetAccessScope } from '../auth/providers/scopes';
import { IdTranslator } from '../shared/providers/id-translator';

export async function validateTargetAccess(
  injector: Injector,
  selector: TargetSelectorInput,
  scope: TargetAccessScope = TargetAccessScope.REGISTRY_READ,
) {
  const translator = injector.get(IdTranslator);
  const [organization, project, target] = await Promise.all([
    translator.translateOrganizationId(selector),
    translator.translateProjectId(selector),
    translator.translateTargetId(selector),
  ]);

  await injector.get(AuthManager).ensureTargetAccess({
    organization,
    project,
    target,
    scope,
  });

  return await injector.get(Storage).getTarget({ target, organization, project });
}
