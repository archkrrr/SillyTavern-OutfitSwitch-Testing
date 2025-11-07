import { getOutfitSlashCommandConfig } from "./verbs.js";

export function createOutfitSlashCommandRegistration(runTriggerByName) {
    if (typeof runTriggerByName !== "function") {
        throw new TypeError("runTriggerByName must be a function");
    }

    const slashConfig = getOutfitSlashCommandConfig();
    const handler = async (args) => {
        const triggerText = Array.isArray(args) ? args.join(" ") : String(args ?? "");
        return runTriggerByName(triggerText, "slash");
    };

    const aliases = Array.isArray(slashConfig.aliases) ? [...slashConfig.aliases] : [];

    return {
        name: slashConfig.name,
        handler,
        args: slashConfig.args,
        description: slashConfig.description,
        aliases,
    };
}

export function applySlashCommandRegistration(registrar, registration) {
    if (typeof registrar !== "function") {
        throw new TypeError("registrar must be a function");
    }

    if (!registration || typeof registration !== "object") {
        throw new TypeError("registration must be an object");
    }

    const aliasList = Array.isArray(registration.aliases) ? registration.aliases : [];
    const legacyAlias = aliasList.length ? aliasList : null;

    const callLegacySignature = () => {
        registrar(
            registration.name,
            registration.handler,
            registration.args,
            registration.description,
            false,
            legacyAlias,
        );
    };

    if (registrar.length <= 3) {
        const options = {
            args: registration.args,
            description: registration.description,
            hidden: false,
            aliases: aliasList,
        };

        try {
            registrar(registration.name, registration.handler, options);
            return;
        } catch (error) {
            const message = String(error?.message ?? "");
            if (!(error instanceof TypeError) || !message.includes("find is not a function")) {
                throw error;
            }
        }

        callLegacySignature();
        return;
    }

    callLegacySignature();
}
