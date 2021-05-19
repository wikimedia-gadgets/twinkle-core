_This file documents changes made between version releases._

### 3.1.0
- `mediawiki.storage` is added as a new dependency. Edit your gadget definition and `dev-loader.js` file to include it.  
- `loadAdditionalMediaWikiMessages()` is deprecated. Instead of using it, set extra messages in `Twinkle.extraMwMessages` array, which would cause `init()` to fetch those too. That is, replace `Twinkle.preModuleInitHooks = [ () => loadAdditionalMediaWikiMessages(mwMessageList) ];` with `Twinkle.extraMwMessages = mwMessageList;`. This change reduces the number of network requests needed to fetch all messages. 

