import { CommunityScopeFilterInterface } from "../../../common/tokens";
import { CommunityRepository } from "../../../foundations/community/repositories/community.repository";
import { GraphCatalogService } from "../../graph/services/graph.catalog.service";

/**
 * Scope filter for summarising one community: its scope root must be
 * groupable, or, with no scope root, its company. Unbound filter → groupable.
 *
 * Root types come from the catalog, as CommunityDetectorService.listScopeRoots
 * reads them. The caller runs inside a CLS context holding the community's
 * company, so the repository read stays company-scoped.
 */
export async function isCommunityGroupable(params: {
  filter?: CommunityScopeFilterInterface;
  catalog?: GraphCatalogService;
  communityRepository: CommunityRepository;
  communityId: string;
  companyId: string;
}): Promise<boolean> {
  const { filter } = params;
  if (!filter) return true;

  const rootLabels = (params.catalog?.getAllEntities() ?? [])
    .filter((entity) => entity.scope?.path.length === 0 && entity.scope.rootType === entity.type)
    .map((entity) => entity.labelName);

  const scopeRoot = await params.communityRepository.findScopeRootForCommunity({
    communityId: params.communityId,
    rootLabels,
  });
  return scopeRoot
    ? filter.canGroup({ companyId: params.companyId, scope: { id: scopeRoot.id, type: scopeRoot.type } })
    : filter.canGroup({ companyId: params.companyId });
}
