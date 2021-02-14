# twinkle-core

This is intended to be the "core" repository for Twinkle using which Twinkle installations for different wikis can be created.

The twinkle-starter repository (yet to be created) will provide a template using which a new Twinkle installation can be started off easily. Each twinkle installation relies on twinkle-core as an npm dependency. 

[![Download stats](https://nodei.co/npm/twinkle-core.png?downloads=true&downloadRank=true)](https://nodei.co/npm/twinkle-core/)

Documentation for twinkle-core is hosted on Toolforge. Check it out at https://tools-static.wmflabs.org/twinkle/core-docs ([alternative link](https://twinkle.toolforge.org/core-docs)).

As is the custom with TypeScript libraries, the GitHub repo only contains the TS  source files, and the NPM package only contains the built JS and .d.ts files.

## Contributing
- Set up an IDE or code editor configuration to work with JS/TS. Popular choices include Visual Studio Code or one of the JetBrains IDEs if you have a licence (JetBrains offers free licenses to [MediaWiki contributors](https://www.mediawiki.org/wiki/JetBrains_IDEs) and [students](https://www.jetbrains.com/community/education/#students)). 
- See [the integrated development workflow](https://github.com/wikimedia/wvui#integrated-development-workflow) to work on twinkle-core while developing or testing a localised twinkle installation. The linked resource is from another repo – replace "WVUI" with "twinkle-core".

## TODO
- [x] Set up webpack production build (using ts-loader)
- [x] Set up a webpack build for debugging
- [x] Explore Typedoc and figure out a scheme for twinkle-core docs
- [ ] Start twinkle-starter: a template repository that enables developers to quickly get started with a new twinkle localisation, with all the tooling already set up.
- [ ] Write a deploy script, to automate release of updates to on-wiki gadget pages.
- [ ] Add the setup for translating message strings (using banana-i18n)
- [ ] localisation of config module
- [x] set up the core Twinkle class
- [x] Add the setup for unit testing (using jest) 
- [ ] set up mock-mediawiki for mocking MediaWiki in a node environment for unit tests.

Originally created by @siddharthvp (SD0001) as part of [Grants:Project/Rapid/SD0001/Twinkle localisation](https://meta.wikimedia.org/wiki/Grants:Project/Rapid/SD0001/Twinkle_localisation).
