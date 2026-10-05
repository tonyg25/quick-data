import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function loadApp() {
  const element = { addEventListener() {} };
  const context = vm.createContext({
    document: { getElementById: () => element },
  });
  vm.runInContext(appSource, context);
  return context;
}

test("cluster keywords use the matching TF-IDF vector when blank-text rows are interspersed", () => {
  const context = loadApp();
  context.posts = [
    { i: 0, text: "launch cobalt", engagement: 1 },
    { i: 2, text: "launch titanium", engagement: 1 },
    { i: 3, text: "engine turbine", engagement: 1 },
    { i: 4, text: "engine valve", engagement: 1 },
    { i: 5, text: "engine rotor", engagement: 1 },
  ];

  const clusters = JSON.parse(vm.runInContext(
    "JSON.stringify(clusterByTopTerms(posts, buildTfIdf(posts)))",
    context,
  ));
  const launch = clusters.find(cluster => cluster.term === "launch");

  assert.ok(launch, "the shared launch topic should form a cluster");
  assert.ok(launch.keywords.includes("titanium"), "the second launch post's keyword should be retained");
  assert.ok(!launch.keywords.includes("turbine"), "a later engine post's keyword must not leak into the launch cluster");
});
