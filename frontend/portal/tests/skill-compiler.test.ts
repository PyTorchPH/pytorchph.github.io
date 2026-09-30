import assert from "node:assert/strict";
import test from "node:test";
import { parseCompiledSkills } from "../../features/organization/skill-compiler/compile";
import { pagesOf } from "../../features/leaderboards/render-skill-tally";

const raw = [{ raw: "beautifulsoup", members: 3 }, { raw: "playwright", members: 2 }, { raw: "pytorch", members: 9 }, { raw: "excel", members: 1 }];

test("the AI reply is trusted only for raw words that exist, each mapped once", () => {
  const reply = "```json\n" + JSON.stringify({ skills: [
    { name: "Web scraping and automation", category: "Web", aliases: ["BeautifulSoup", "playwright", "scrapy"] },
    { name: "Browser testing", category: "Web", aliases: ["playwright"] },
    { name: "PyTorch", category: "Machine learning", aliases: ["pytorch"] },
  ] }) + "\n```";
  const result = parseCompiledSkills(reply, raw);
  assert.deepEqual(result.skills.map((skill) => [skill.name, skill.aliases]), [
    ["Web scraping and automation", ["beautifulsoup", "playwright"]],
    ["PyTorch", ["pytorch"]],
  ]);
  assert.deepEqual(result.unmapped, ["excel"]);
});

test("a reply without a skill list is rejected", () => {
  assert.throws(() => parseCompiledSkills("not json", raw));
  assert.throws(() => parseCompiledSkills("{}", raw));
});

test("slides hold a fixed number of rows each", () => {
  assert.deepEqual(pagesOf([1, 2, 3, 4, 5, 6, 7], 3), [[1, 2, 3], [4, 5, 6], [7]]);
  assert.deepEqual(pagesOf([], 3), []);
});
