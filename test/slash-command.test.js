import test from "node:test";
import assert from "node:assert/strict";
import {
    createOutfitSlashCommandRegistration,
    applySlashCommandRegistration,
} from "../src/slash-command.js";

test("slash command registration joins arguments and tags slash source", async () => {
    const calls = [];
    const registration = createOutfitSlashCommandRegistration(async (trigger, source) => {
        calls.push({ trigger, source });
        return `${trigger}:${source}`;
    });

    const result = await registration.handler(["winter", "gala"]);

    assert.equal(result, "winter gala:slash");
    assert.deepEqual(calls, [{ trigger: "winter gala", source: "slash" }]);
    assert.equal(typeof registration.handler, "function");
    assert.deepEqual(registration.aliases, []);
});

test("legacy slash command signature receives a null alias", () => {
    const registration = createOutfitSlashCommandRegistration(async () => "ok");
    const calls = [];

    function legacyRegister(name, handler, args, description, hidden, alias) {
        calls.push({ name, handler, args, description, hidden, alias });
    }

    applySlashCommandRegistration(legacyRegister, registration);

    assert.equal(calls.length, 1);
    const entry = calls[0];
    assert.equal(entry.name, registration.name);
    assert.deepEqual(entry.args, registration.args);
    assert.equal(entry.description, registration.description);
    assert.equal(entry.hidden, false);
    assert.equal(entry.alias, null);
});

test("object-based slash command signature receives empty alias list", () => {
    const registration = createOutfitSlashCommandRegistration(async () => "ok");
    const calls = [];

    function objectRegister(name, handler, options) {
        calls.push({ name, handler, options });
    }

    applySlashCommandRegistration(objectRegister, registration);

    assert.equal(calls.length, 1);
    const entry = calls[0];
    assert.equal(entry.name, registration.name);
    assert.deepEqual(entry.options.args, registration.args);
    assert.equal(entry.options.description, registration.description);
    assert.equal(entry.options.hidden, false);
    assert.deepEqual(entry.options.aliases, []);
});
