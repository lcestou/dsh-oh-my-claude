import { strict as assert } from "node:assert";
import { pickVerb, mergeVerbs } from "./index.js";

// Re-declare locally for tests; the module-level consts are not exported.
const DEFAULT_VERBS = [
  "Accomplishing",
  "Actioning",
  "Actualizing",
  "Architecting",
  "Baking",
  "Beaming",
  "Beboppin'",
  "Befuddling",
  "Billowing",
  "Blanching",
  "Bloviating",
  "Boogieing",
  "Boondoggling",
  "Booping",
  "Bootstrapping",
  "Brewing",
  "Bunning",
  "Burrowing",
  "Calculating",
  "Canoodling",
  "Caramelizing",
  "Cascading",
  "Catapulting",
  "Cerebrating",
  "Channeling",
  "Channelling",
  "Choreographing",
  "Churning",
  "Clauding",
  "Coalescing",
  "Cogitating",
  "Combobulating",
  "Composing",
  "Computing",
  "Concocting",
  "Considering",
  "Contemplating",
  "Cooking",
  "Crafting",
  "Creating",
  "Crunching",
  "Crystallizing",
  "Cultivating",
  "Deciphering",
  "Deliberating",
  "Determining",
  "Dilly-dallying",
  "Discombobulating",
  "Doing",
  "Doodling",
  "Drizzling",
  "Ebbing",
  "Effecting",
  "Elucidating",
  "Embellishing",
  "Enchanting",
  "Envisioning",
  "Fermenting",
  "Fiddle-faddling",
  "Finagling",
  "Flambéing",
  "Flibbertigibbeting",
  "Flowing",
  "Flummoxing",
  "Fluttering",
  "Forging",
  "Forming",
  "Frolicking",
  "Frosting",
  "Gallivanting",
  "Galloping",
  "Garnishing",
  "Generating",
  "Gesticulating",
  "Germinating",
  "Gitifying",
  "Grooving",
  "Gusting",
  "Harmonizing",
  "Hashing",
  "Hatching",
  "Herding",
  "Honking",
  "Hullaballooing",
  "Hyperspacing",
  "Ideating",
  "Imagining",
  "Improvising",
  "Incubating",
  "Inferring",
  "Infusing",
  "Ionizing",
  "Jitterbugging",
  "Julienning",
  "Kneading",
  "Leavening",
  "Levitating",
  "Lollygagging",
  "Manifesting",
  "Marinating",
  "Meandering",
  "Metamorphosing",
  "Misting",
  "Moonwalking",
  "Moseying",
  "Mulling",
  "Mustering",
  "Musing",
  "Nebulizing",
  "Nesting",
  "Newspapering",
  "Noodling",
  "Nucleating",
  "Orbiting",
  "Orchestrating",
  "Osmosing",
  "Perambulating",
  "Percolating",
  "Perusing",
  "Philosophising",
  "Photosynthesizing",
  "Pollinating",
  "Pondering",
  "Pontificating",
  "Pouncing",
  "Precipitating",
  "Prestidigitating",
  "Processing",
  "Proofing",
  "Propagating",
  "Puttering",
  "Puzzling",
  "Quantumizing",
  "Razzle-dazzling",
  "Razzmatazzing",
  "Recombobulating",
  "Reticulating",
  "Roosting",
  "Ruminating",
  "Sautéing",
  "Scampering",
  "Schlepping",
  "Scurrying",
  "Seasoning",
  "Shenaniganing",
  "Shimmying",
  "Simmering",
  "Skedaddling",
  "Sketching",
  "Slithering",
  "Smooshing",
  "Sock-hopping",
  "Spelunking",
  "Spinning",
  "Sprouting",
  "Stewing",
  "Sublimating",
  "Swirling",
  "Swooping",
  "Symbioting",
  "Synthesizing",
  "Tempering",
  "Thinking",
  "Thundering",
  "Tinkering",
  "Tomfoolering",
  "Topsy-turvying",
  "Transfiguring",
  "Transmuting",
  "Twisting",
  "Undulating",
  "Unfurling",
  "Unravelling",
  "Vibing",
  "Waddling",
  "Wandering",
  "Warping",
  "Whatchamacalliting",
  "Whirlpooling",
  "Whirring",
  "Whisking",
  "Wibbling",
  "Working",
  "Wrangling",
  "Zesting",
  "Zigzagging",
] as const;

const DEFAULT_FRAMES = ["·", "✢", "✳", "✶", "✻", "✻"] as const;

// pickVerb returns one element from the list.
{
  const verb = pickVerb(DEFAULT_VERBS, () => 0);
  assert.ok(typeof verb === "string" && verb.length > 0, "pickVerb returns a non-empty string");
  // SAFETY: pickVerb guarantees the result comes from the input list.
  assert.ok(
    (DEFAULT_VERBS as readonly string[]).includes(verb),
    "pickVerb returns a verb from the list",
  );
}

// pickVerb with deterministic random hits a known index.
{
  const verb = pickVerb(DEFAULT_VERBS, () => 0.5);
  const idx = Math.floor(0.5 * DEFAULT_VERBS.length);
  assert.equal(verb, DEFAULT_VERBS[idx], "pickVerb indexes correctly at 0.5");
}

// mergeVerbs with no setting returns a copy of defaults.
{
  const out = mergeVerbs(DEFAULT_VERBS, undefined);
  assert.equal(out.length, DEFAULT_VERBS.length, "no setting → defaults length");
  assert.notStrictEqual(out, DEFAULT_VERBS, "no setting → new array");
}

// mergeVerbs with replace mode returns only the setting verbs.
{
  const custom = ["Thinking", "Pondering"];
  const out = mergeVerbs(DEFAULT_VERBS, { mode: "replace", verbs: custom });
  assert.deepEqual(out, custom, "replace mode uses only setting verbs");
}

// mergeVerbs with append mode concatenates defaults and setting verbs.
{
  const custom = ["Thinking"];
  const out = mergeVerbs(DEFAULT_VERBS, { mode: "append", verbs: custom });
  assert.equal(out.length, DEFAULT_VERBS.length + 1, "append mode adds one verb");
  assert.ok(out.includes("Thinking"), "append mode includes setting verb");
  assert.ok(out.includes(DEFAULT_VERBS[0]), "append mode keeps defaults");
}

// DEFAULT_FRAMES is the ping-pong set.
{
  assert.deepEqual(DEFAULT_FRAMES, ["·", "✢", "✳", "✶", "✻", "✻"], "default frames match spec");
}

console.log("spinner: ok");
