import test from "node:test";
import assert from "node:assert/strict";
import {
    OUTFIT_ACTION_VERBS,
    OUTFIT_SLASH_ARGUMENTS,
    OUTFIT_SLASH_COMMAND,
    OUTFIT_SLASH_DESCRIPTION,
    OUTFIT_SLASH_ALIASES,
    getOutfitSlashCommandConfig,
    isOutfitActionVerb,
} from "../src/verbs.js";

test("outfit action verbs only include outfit switching terms", () => {
    assert.deepEqual(OUTFIT_ACTION_VERBS, ["switch", "change", "swap"]);
    assert.equal(isOutfitActionVerb("switch"), true);
    assert.equal(isOutfitActionVerb("speaker"), false);
    assert.equal(isOutfitActionVerb(""), false);
});

test("slash command config targets outfit switching", () => {
    const config = getOutfitSlashCommandConfig();
    assert.equal(config.name, OUTFIT_SLASH_COMMAND);
    assert.deepEqual(config.args, OUTFIT_SLASH_ARGUMENTS);
    assert.equal(config.description, OUTFIT_SLASH_DESCRIPTION);
    assert.deepEqual(config.aliases, OUTFIT_SLASH_ALIASES);
    assert.equal(config.name, "outfitswitch");
    assert.deepEqual(config.args, ["trigger"]);
    assert.equal(OUTFIT_SLASH_DESCRIPTION, "Manually activate an Outfit Switcher trigger by name.");
    assert.ok(config.description.includes("Outfit Switcher trigger"));
    assert.equal(config.description.toLowerCase().includes("speaker"), false);
    assert.deepEqual(config.aliases, []);
});
