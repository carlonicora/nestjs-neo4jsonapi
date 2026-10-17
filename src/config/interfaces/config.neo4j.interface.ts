export interface ConfigNeo4jInterface {
  uri: string;
  username: string;
  password: string;
  database: string;
  // When false, initQuery does not MATCH the request's :Company / :User nodes. Set it for an app whose
  // database holds no :Company / :User nodes (e.g. a corpus service on its own database): there the
  // MATCH finds nothing and every query returns zero rows. Entities that need the company
  // (isCompanyScoped, or tenancy "self" / { via }) are then refused by AbstractRepository. Default true.
  bindRequestContext?: boolean;
}
