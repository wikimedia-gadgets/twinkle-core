# twinkle-core

This is intended to be the "core" repository for Twinkle using which Twninkle installations for different wikis can be created. 

The twinkle-starter repository (yet to be created) will provide a template using which a new Twinkle installation can be started off easily. Each twinkle installation relies on twinkle-core as an npm dependency.

Documentation for twinkle-core is available at https://tools-static.wmflabs.org/twinkle/core-docs/

Meta TODOs: 
- [x] Set up webpack production build (using ts-loader)
- [x] Set up a webpack build for debugging
- [x] Explore Typedoc and figure out a scheme for twinkle-core docs
- [ ] Start twinkle-starter
- [ ] Write a deploy script
- [ ] Set up messages infra (using jquery.i18n or banana-i18n)
- [ ] localisation of config module
- [x] set up the core Twinkle class
- [x] set up infra for unit testing (using jest) 
- [ ] set up mock-mediawiki

Originally created by @siddharthvp (SD0001) as part of [Grants:Project/Rapid/SD0001/Twinkle localisation](https://meta.wikimedia.org/wiki/Grants:Project/Rapid/SD0001/Twinkle_localisation).
