export const updateRelationshipQuery = (params: {
  node: string;
  relationshipName: string;
  relationshipToNode: boolean;
  label: string;
  param: string;
  values: string[];
  relationshipProperties?: { [key: string]: any }[] | ((id: string) => { [key: string]: any });
  queryParams?: any;
}): string => {
  // COLLISION FIX: Use alias when node and param names collide
  const paramAlias = params.node.toLowerCase() === params.param.toLowerCase() ? `${params.param}_ids` : params.param;

  // SYNC queryParams: When there's a collision, copy values to the aliased key
  if (params.queryParams && params.node.toLowerCase() === params.param.toLowerCase()) {
    if (params.queryParams[params.param] !== undefined) {
      params.queryParams[paramAlias] = params.queryParams[params.param];
    }
  }

  let relationshipProps = "";
  const propertiesMapParam = `${paramAlias}PropertiesMap`;

  if (params.relationshipProperties) {
    // Check if it's a resolver function
    if (typeof params.relationshipProperties === "function") {
      // Store the function with proper type
      const resolver = params.relationshipProperties as (id: string) => { [key: string]: any };

      // Build a map by calling the resolver for each ID
      const propertiesMap: { [id: string]: { [key: string]: any } } = {};

      if (params.values && params.values.length > 0) {
        params.values.forEach((id) => {
          propertiesMap[id] = resolver(id);
        });
      }

      // Add the map to queryParams if provided
      if (params.queryParams) {
        params.queryParams[propertiesMapParam] = propertiesMap;
      }

      // Build SET clause that accesses the map
      const firstId = params.values?.[0];
      if (firstId) {
        const sampleProps = resolver(firstId);
        relationshipProps = Object.keys(sampleProps)
          .map((key) => `rel.${key} = $${propertiesMapParam}[id].${key}`)
          .join(", ");
      }
    } else {
      // Original behavior for static array
      relationshipProps = params.relationshipProperties
        .flatMap((propObj) =>
          Object.entries(propObj).map(
            ([key, value]) => `rel.${key} = ${typeof value === "string" ? "'" + value + "'" : value}`,
          ),
        )
        .join(", ");
    }
  }

  return `
    WITH ${params.node}
    OPTIONAL MATCH (${params.node})${params.relationshipToNode ? "-" : "<-"}[rel:${params.relationshipName}]${params.relationshipToNode ? "->" : "-"}(existing:${params.label})
    WHERE NOT existing.id IN $${paramAlias}
    DELETE rel

    ${
      params.values && params.values.length > 0
        ? `
        WITH ${params.node}, $${paramAlias} AS ${paramAlias}
        UNWIND ${paramAlias} AS id
        MATCH (new:${params.label} {id: id})
        MERGE (${params.node})${params.relationshipToNode ? "-" : "<-"}[rel:${params.relationshipName}]${params.relationshipToNode ? "->" : "-"}(new)
        ${relationshipProps ? `SET ${relationshipProps}, rel.updatedAt = datetime()` : `SET rel.updatedAt = datetime()`}
        `
        : ``
    }
    `;
};
