export const OUTFIT_ACTION_VERBS = Object.freeze(["switch", "change", "swap"]);

export function isOutfitActionVerb(value) {
    if (!value) {
        return false;
    }
    const lookup = String(value).trim().toLowerCase();
    return OUTFIT_ACTION_VERBS.includes(lookup);
}

export const OUTFIT_SLASH_COMMAND = "outfitswitch";
export const OUTFIT_SLASH_ARGUMENTS = Object.freeze(["trigger"]);
export const OUTFIT_SLASH_DESCRIPTION = "Manually activate an Outfit Switcher trigger by name.";
export const OUTFIT_SLASH_ALIASES = Object.freeze([]);

export function getOutfitSlashCommandConfig() {
    return {
        name: OUTFIT_SLASH_COMMAND,
        args: OUTFIT_SLASH_ARGUMENTS,
        description: OUTFIT_SLASH_DESCRIPTION,
        aliases: OUTFIT_SLASH_ALIASES,
    };
}
