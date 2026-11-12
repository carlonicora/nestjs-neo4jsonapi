import { describe, expect, it } from "vitest";
import { JsonApiPaginator } from "../jsonapi.paginator";

/** One row more than the page size: the shape a `{CURSOR}` query returns when a next page exists. */
const fullPage = (size: number) => Array.from({ length: size + 1 }, (_, i) => ({ id: `row-${i}` }));

describe("JsonApiPaginator links keep the sort", () => {
  it("carries sort=-name into links.next when the request URL holds it", () => {
    const query = { sort: "-name", "page[size]": "2" };
    const paginator = new JsonApiPaginator(query);

    const links = paginator.generateLinks(fullPage(2), "https://api.test/things?sort=-name&page[size]=2");

    expect(links.next).toBeDefined();
    expect(links.next).toContain("sort=-name");
    expect(links.next).toContain("page[offset]=2");
  });

  it("carries sort=-name into links.next when the URL has no query string (additional params path)", () => {
    const query = { sort: "-name", "page[size]": "2" };
    const paginator = new JsonApiPaginator(query);

    const links = paginator.generateLinks(fullPage(2), "https://api.test/things");

    expect(links.next).toContain("sort=-name");
  });

  it("carries a multi-key sort into links.next and links.previous on page 2", () => {
    const query = { sort: "lastName,firstName", "page[size]": "2", "page[offset]": "2" };
    const paginator = new JsonApiPaginator(query);

    const links = paginator.generateLinks(
      fullPage(2),
      "https://api.test/things?sort=lastName,firstName&page[size]=2&page[offset]=2",
    );

    expect(links.next).toContain("sort=lastName,firstName");
    expect(links.previous).toContain("sort=lastName,firstName");
  });
});
