# twinkle-core

This is intended to be the "core" repository for [Twinkle](https://en.wikipedia.org/wiki/Wikipedia:Twinkle) using which Twinkle installations for different wikis can be created (for example: [twinkle-enwiki](https://github.com/wikimedia-gadgets/twinkle-starter))

The [twinkle-starter repository](https://github.com/wikimedia-gadgets/twinkle-starter) provides a template using which a new Twinkle installation can be started off easily. Each twinkle installation relies on twinkle-core as an npm dependency. Please refer to the README of twinkle-starter for instructions on setting up twinkle for a new wiki.

[![Download stats](https://nodei.co/npm/twinkle-core.png?downloads=true&downloadRank=true)](https://nodei.co/npm/twinkle-core/)

Documentation for twinkle-core is hosted on Toolforge. Check it out at https://tools-static.wmflabs.org/twinkle/core-docs ([alternative link](https://twinkle.toolforge.org/core-docs)).

Twinkle-core uses [orange-i18n](https://github.com/wikimedia-gadgets/orange-i18n) for internationalisation. A fork of [banana-i18n](https://github.com/wikimedia/banana-i18n), it uses the same format for messages as MediaWiki. Translations are coordinated via translatewiki.net. See https://translatewiki.net/wiki/Translating:Twinkle for contributing translations.

## Contributing

- Set up an IDE or code editor to work with JS/TS. Popular choices include Visual Studio Code or one of the JetBrains IDEs if you have a licence (JetBrains offers free licenses to [MediaWiki contributors](https://www.mediawiki.org/wiki/JetBrains_IDEs) and [students](https://www.jetbrains.com/community/education/#students)). If you are a command line veteran, check out [TypeScript for Vim](https://www.vimfromscratch.com/articles/setting-up-vim-for-typescript/) or [emacs](https://wikemacs.org/wiki/TypeScript)!
- Work on twinkle-core is usually done while developing or testing a localised twinkle installation (such as [twinkle-enwiki](https://github.com/wikimedia-gadgets/twinkle-enwiki)). In twinkle-enwiki, all imports from twinkle-core are used through the gateway file [core.ts file](https://github.com/wikimedia-gadgets/twinkle-enwiki/blob/master/src/core.ts). Change `export * from 'twinkle-core';`there to `export * from '../../twinkle-core/src/index';`. (Assuming that you have twinkle-core and twinkle-enwiki cloned as sibling directories).
  - Some other projects such as WVUI follow a somewhat [more systematic workflow](https://github.com/wikimedia/wvui#integrated-development-workflow). You can also try this method though it wasn't working reliably for me. 
- Try to ensure all documentation comments align with the [TSDoc standard](https://tsdoc.org/), and [what Typedoc supports](https://typedoc.org/guides/doccomments/).

## Workflows

- On every push to the master branch, the [documentation on Toolforge](https://twinkle.toolforge.org/core-docs) is automatically updated by the [docs-deploy workflow](https://github.com/wikimedia-gadgets/twinkle-core/blob/master/.github/workflows/docs-deploy.yml). 
- Another workflow ([i18n-deploy.yml](https://github.com/wikimedia-gadgets/twinkle-core/blob/master/.github/workflows/i18n-deploy.yml)) sanitises new i18n messages synced from translatewiki.net using the [build-i18n script](https://github.com/wikimedia-gadgets/twinkle-core/blob/master/scripts/build-i18n.js) and syncs them to the [i18n branch](https://github.com/wikimedia-gadgets/twinkle-core/tree/i18n) which only contains built i18n messages. This branch is mirrored to the [TwinkleCore Gerrit repository](https://gerrit.wikimedia.org/r/admin/repos/mediawiki%2Fgadgets%2FTwinkleCore). Wikis can fetch i18n messages from Gerrit in a CSP-compliant way.
- You can create a new release using the [releases tab in GitHub UI](https://github.com/wikimedia-gadgets/twinkle-core/releases). This triggers the [npm-publish workflow](https://github.com/wikimedia-gadgets/twinkle-core/blob/master/.github/workflows/npm-publish.yml) to publish a new version of the [NPM package](https://www.npmjs.com/package/twinkle-core). Be sure that the version number in package.json was updated before this is done (trying to republish with the same version will not work).
- On every new release, the docs-deploy workflow also saves the documentation to a permanent link (eg. for v3.0.2-beta at https://twinkle.toolforge.org/core-docs-3.0.2-beta).

## Credits
Thanks to the authors of [wikimedia-gadgets/twinkle](https://github.com/wikimedia-gadgets/twinkle) from which the code is adapted.

This repository was created by siddharthvp (SD0001) as part of [Grants:Project/Rapid/SD0001/Twinkle localisation](https://meta.wikimedia.org/wiki/Grants:Project/Rapid/SD0001/Twinkle_localisation).
