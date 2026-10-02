/**
 * The relevance scoring shared by every relevance read.
 *
 * By default the fragment ends with `ORDER BY totalScore DESC {CURSOR}`, so the
 * page is cut here. A caller that filters the scored rows afterwards passes
 * `deferCursor: true`: the fragment then ends on the scored projection and the
 * caller appends `ORDER BY totalScore DESC {CURSOR}` after its own filters, so a
 * page is filled from rows that survive them and the pagination total (the
 * query up to `{CURSOR}`) counts the same rows.
 */
const query = (params: { term?: string; deferCursor?: boolean }): string => {
  return `
        OPTIONAL MATCH (chunk)-[:HAS_ATOMIC_FACT]->(:AtomicFact)-[:HAS_KEY_CONCEPT]->(startingKC:KeyConcept)
        OPTIONAL MATCH (chunk)<-[:OCCURS_IN]-(startingKCR:KeyConceptRelationship)-[:BELONGS_TO]->(company)
        WITH company, collect(DISTINCT startingKC)  AS startingKCs, collect(DISTINCT startingKCR) AS startingKCRs

       CALL {
          WITH company, startingKCs
          WITH company, CASE WHEN startingKCs IS NULL OR size(startingKCs)=0 THEN [NULL] ELSE startingKCs END AS kcs, 1 AS keep
          UNWIND kcs AS startingKC
          OPTIONAL MATCH (startingKC)<-[:HAS_KEY_CONCEPT]-(:AtomicFact)<-[:HAS_ATOMIC_FACT]-(:Chunk)<-[:HAS_CHUNK]-(rc1)-[:BELONGS_TO]->(company)
          WITH keep, rc1
          WITH keep, rc1, count(*) AS kcScore
          WITH keep, collect({content: rc1, score: kcScore}) AS tmp
          RETURN [x IN tmp WHERE x.content IS NOT NULL] AS kcResults
        }

        CALL {
          WITH company, startingKCRs
          WITH company,CASE WHEN startingKCRs IS NULL OR size(startingKCRs)=0 THEN [NULL] ELSE startingKCRs END AS kcrs,1 AS keep
          UNWIND kcrs AS startingKCR
          OPTIONAL MATCH (startingKCR)-[:RELATES_TO]->(:KeyConcept)<-[:HAS_KEY_CONCEPT]-(:AtomicFact)<-[:HAS_ATOMIC_FACT]-(:Chunk)<-[:HAS_CHUNK]-(rc2)-[:BELONGS_TO]->(company)
          WITH keep, rc2, startingKCR
          WITH keep, rc2, sum(coalesce(startingKCR.weight, 0)) AS kcrScore
          WITH keep, collect({content: rc2, score: kcrScore}) AS tmp
          RETURN [x IN tmp WHERE x.content IS NOT NULL] AS kcrResults
        }

        WITH kcResults, kcrResults, startingKCs, startingKCRs
        WITH 1 AS keep, kcResults + kcrResults AS combinedResults, size(startingKCs) + size(startingKCRs) AS totalKCs
        UNWIND CASE WHEN size(combinedResults)=0 THEN [NULL] ELSE combinedResults END AS r
        WITH keep, r, totalKCs
        WHERE r IS NOT NULL
        WITH keep, r.content AS content, r.score AS score, totalKCs
        WITH keep, content, sum(score) AS totalCount, totalKCs
        WITH keep, content, CASE 
            WHEN totalKCs = 0 THEN 0
            WHEN (toFloat(totalCount) * 100.0 / totalKCs) > 100 THEN 100
            ELSE (toFloat(totalCount) * 100.0 / totalKCs)
          END AS totalScore

        ${params.term ? "WHERE toLower(content.name) CONTAINS toLower($term)" : ""}
${
  params.deferCursor
    ? ``
    : `
        ORDER BY totalScore DESC
        {CURSOR}`
}
    `;
};

const queryForAuthor = (params: { term?: string }): string => {
  return `
        OPTIONAL MATCH (chunk)-[:HAS_ATOMIC_FACT]->(:AtomicFact)-[:HAS_KEY_CONCEPT]->(startingKC:KeyConcept)
        OPTIONAL MATCH (chunk)<-[:OCCURS_IN]-(startingKCR:KeyConceptRelationship)-[:BELONGS_TO]->(company)
        WITH company, collect(DISTINCT startingKC)  AS startingKCs, collect(DISTINCT startingKCR) AS startingKCRs

        CALL {
          WITH company, startingKCs
          WITH company,
              CASE WHEN startingKCs IS NULL OR size(startingKCs)=0 THEN [NULL] ELSE startingKCs END AS kcs,
              1 AS keep  // anchor to preserve one row
          UNWIND kcs AS startingKC
          OPTIONAL MATCH (startingKC)<-[:HAS_KEY_CONCEPT]-(:AtomicFact)<-[:HAS_ATOMIC_FACT]-(:Chunk)<-[:HAS_CHUNK]-()-[:AUTHORED_BY|EDITED_BY]->(author1)-[:BELONGS_TO]->(company)
          WITH keep, author1
          WITH keep, author1, count(*) AS kcScore
          WITH keep, collect({content: author1, score: kcScore}) AS tmp
          RETURN [x IN tmp WHERE x.content IS NOT NULL] AS kcResults
        }

        CALL {
          WITH company, startingKCRs
          WITH company,
              CASE WHEN startingKCRs IS NULL OR size(startingKCRs)=0 THEN [NULL] ELSE startingKCRs END AS kcrs,
              1 AS keep
          UNWIND kcrs AS startingKCR
          OPTIONAL MATCH (startingKCR)-[:RELATES_TO]->(:KeyConcept)<-[:HAS_KEY_CONCEPT]-(:AtomicFact)<-[:HAS_ATOMIC_FACT]-(:Chunk)<-[:HAS_CHUNK]-()-[:AUTHORED_BY|EDITED_BY]->(author2)-[:BELONGS_TO]->(company)
          WITH keep, author2, startingKCR
          WITH keep, author2, sum(coalesce(startingKCR.weight, 0)) AS kcrScore
          WITH keep, collect({content: author2, score: kcrScore}) AS tmp
          RETURN [x IN tmp WHERE x.content IS NOT NULL] AS kcrResults
        }

        WITH kcResults, kcrResults, startingKCs, startingKCRs
        WITH 1 AS keep, kcResults + kcrResults AS combinedResults, size(startingKCs) + size(startingKCRs) AS totalKCs
        UNWIND CASE WHEN size(combinedResults)=0 THEN [NULL] ELSE combinedResults END AS r
        WITH keep, r, totalKCs
        WHERE r IS NOT NULL
        WITH keep, r.content AS author, r.score AS score, totalKCs
        WITH keep, author, sum(score) AS totalCount, totalKCs
        WITH keep, author, CASE 
          WHEN totalKCs = 0 THEN 0
          WHEN (toFloat(totalCount) * 100.0 / totalKCs) > 100 THEN 100
          ELSE (toFloat(totalCount) * 100.0 / totalKCs)
        END AS totalScore

        ${params.term ? "WHERE toLower(author.name) CONTAINS toLower($term)" : ""}

        ORDER BY totalScore DESC
        {CURSOR}
    `;
};

/**
 * The `source` node of a content relevance read: constrained to the configured
 * content labels (`:Article|Document|…`) so the `{id: $id}` lookup is an index
 * seek per label instead of a scan of every node. Unlabelled (the historical
 * pattern) when no content label is configured.
 */
const sourcePattern = (sourceLabels?: string[]): string =>
  `source${sourceLabels?.length ? `:${sourceLabels.join("|")}` : ``} {id: $id}`;

/**
 * The scored contents related to the source content `$id`, WITHOUT the page cut:
 * the fragment ends on the `content, totalScore` projection, and the caller
 * filters the rows (source exclusion, score threshold, access check) and then
 * appends `ORDER BY totalScore DESC {CURSOR}`.
 */
export const contentQuery = (params: { term?: string; sourceLabels?: string[] }): string => {
  return `
    MATCH (${sourcePattern(params.sourceLabels)})-[:BELONGS_TO]->(company)
    MATCH (source)-[:HAS_CHUNK]->(chunk:Chunk)
    ${query({ term: params.term, deferCursor: true })}
`;
};

/**
 * The scored contents related to the author `$id`. By default the fragment cuts
 * the page itself (`ORDER BY totalScore DESC {CURSOR}`); a caller that filters
 * the scored rows afterwards passes `deferCursor: true` and appends the cut after
 * its own filters (see `query`).
 *
 * The author must belong to the caller's company (`$companyId`), stated in the
 * fragment itself rather than relying on the caller having bound `company`
 * first: an author from another company, or a call with no company in context,
 * matches nothing.
 */
export const authorQuery = (params: { term?: string; deferCursor?: boolean }): string => {
  return `
    MATCH (author {id: $id})-[:BELONGS_TO]->(company:Company {id: $companyId})
    OPTIONAL MATCH (author)<-[:AUTHORED_BY|EDITED_BY]->()-[:HAS_CHUNK]->(chunk:Chunk)
    ${query({ term: params.term, deferCursor: params.deferCursor })}
`;
};

export const contentToAuthorQuery = (params: { term?: string; sourceLabels?: string[] }): string => {
  return `
    MATCH (${sourcePattern(params.sourceLabels)})-[:BELONGS_TO]->(company)
    MATCH (source)-[:HAS_CHUNK]->(chunk:Chunk)
    ${queryForAuthor({ term: params.term })}
`;
};

export const authorToAuthorQuery = (params: { term?: string }): string => {
  return `
    MATCH (author {id: $id})-[:BELONGS_TO]->(company:Company {id: $companyId})
    OPTIONAL MATCH (author)<-[:AUTHORED_BY|EDITED_BY]->()-[:HAS_CHUNK]->(chunk:Chunk)
    ${queryForAuthor({ term: params.term })}
`;
};
