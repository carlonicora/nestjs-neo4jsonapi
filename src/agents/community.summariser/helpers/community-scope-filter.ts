import { CommunityScopeFilterInterface } from "../../../common/tokens";
import { CommunityRepository } from "../../../foundations/community/repositories/community.repository";

/**
 * Scope filter for summarising one community: its scope root must be
 * groupable, or, with no scope root, its company. Unbound filter → groupable.
 *
 * The repository resolves the scope root from the configured community layer.
 * The caller runs inside a CLS context holding the community's company, so the
 * repository read stays company-scoped.
 */
export async function isCommunityGroupable(params: {
  filter?: CommunityScopeFilterInterface;
  communityRepository: CommunityRepository;
  communityId: string;
  companyId: string;
}): Promise<boolean> {
  const { filter } = params;
  if (!filter) return true;

  const scopeRoot = await params.communityRepository.findScopeRootForCommunity({
    communityId: params.communityId,
  });
  return scopeRoot
    ? filter.canGroup({ companyId: params.companyId, scope: { id: scopeRoot.id, type: scopeRoot.type } })
    : filter.canGroup({ companyId: params.companyId });
}
