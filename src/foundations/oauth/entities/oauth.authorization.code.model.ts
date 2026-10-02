import { mapEntity } from "../../../common/abstracts/entity";
import { DataModelInterface } from "../../../common/interfaces/datamodel.interface";
import { EntityFactory } from "../../../core/neo4j/factories/entity.factory";
import { OAuthAuthorizationCode, oauthAuthorizationCodeMeta } from "./oauth.authorization.code.entity";

export const mapOAuthAuthorizationCode = (params: {
  data: any;
  record: any;
  entityFactory: EntityFactory;
}): OAuthAuthorizationCode => {
  return {
    ...mapEntity({ record: params.data }),
    codeHash: params.data.codeHash,
    expiresAt: params.data.expiresAt ? new Date(params.data.expiresAt) : new Date(),
    redirectUri: params.data.redirectUri,
    scope: params.data.scope ?? "",
    state: params.data.state ?? null,
    codeChallenge: params.data.codeChallenge ?? null,
    codeChallengeMethod: params.data.codeChallengeMethod ?? null,
    isUsed: params.data.isUsed ?? false,
    clientId: params.data.clientId,
    userId: params.data.userId,
    companyId: params.data.companyId ?? null,
  };
};

export const OAuthAuthorizationCodeModel: DataModelInterface<OAuthAuthorizationCode> = {
  ...oauthAuthorizationCodeMeta,
  entity: undefined as unknown as OAuthAuthorizationCode,
  mapper: mapOAuthAuthorizationCode,
  serialiser: undefined as any, // Internal use only - no JSON:API serialization
  singleChildrenTokens: [],
};
