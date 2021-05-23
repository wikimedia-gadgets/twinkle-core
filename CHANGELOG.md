
### 3.1.0
Breaking changes/deprecations:

**Please apply [a patch like this](https://github.com/wikimedia-gadgets/twinkle-starter/commit/326e51ac12d5a2e) to your twinkle due to these changes:**  
- `mediawiki.storage` is added as a new dependency. Edit your gadget definition and `dev-loader.js` file to include it.  
- `loadAdditionalMediaWikiMessages()` is deprecated. Instead of using it, set extra messages in `Twinkle.extraMwMessages` array, which would cause `init()` to fetch those too. That is, replace `Twinkle.preModuleInitHooks = [ () => loadAdditionalMediaWikiMessages(mwMessageList) ];` with `Twinkle.extraMwMessages = mwMessageList;`. This change reduces the number of network requests needed to fetch all messages. 

Notable improvements:
- This version brings significant performance improvements in:
  - i18n messages fetched from Gerrit for non-English languages is now cached in the LocalStorage to avoid repeated, slow and mostly uncached requests to Gerrit on every page load.
  - The overall bundle size is greatly reduced due to tree-shaking. The config property to enable this was missing earlier.
  - The i18n library no longer bundles data like language fallbacks, plural rules and digit transforms for all languages. Rather these are now part of the i18n messages files and thus are retrieved only for the active language, without an additional network request.