# SillyTavern Outfit Switcher contributor notes

- Use four spaces for indentation in JavaScript, HTML, and CSS files.
- Favor double quotes for string literals to match the existing style.
- Keep experimental or in-progress features clearly gated behind their feature flags.
- Update or add tests in the `test/` directory when you change profile persistence or detection logic.
- Document noteworthy UI affordances or feature flags in the settings copy so users understand experimental scope.

# notes

- `SillyTavern-CostumeSwitch/` is my main extension, use it for reference for things like layout and UI.
- Do not change anything in `SillyTavern-CostumeSwitch/`.
  `ST-Helpers/` is a library released to the public for extension developers, it is to only be used to help with the development of Outfit Switcher. It is for reference only, and not to be edited.
