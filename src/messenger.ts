import Banana, { Messages } from 'orange-i18n';
import messages from './messages.json';
import MWMessages from './mw-messages';

let banana = new Banana(mw.config.get('wgContentLanguage'));

/**
 * Load messages into the message store.
 * @param messages
 */
export function loadMessages(messages: Messages) {
	banana.load(messages, mw.config.get('wgContentLanguage'));
}

/**
 * Get parsed message.
 * @param msg - the message name
 * @param parameters - the parameters for $1, $2, ... substitutions
 */
export function msg(msg: string, ...parameters: (string | number | string[])[]) {
	return banana.i18n(msg, ...parameters);
}

/**
 * Initialize the message store. Called from init.ts.
 */
export function initMessaging() {
	// Populate messages in object
	loadMessages(messages);

	// Set Morebits i18n
	Morebits.i18n.setParser({ get: msg });

	// Load MW messages and return the promise
	return loadMediaWikiMessages();
}

/**
 * Load the messages available in MediaWiki using the API.
 * These will include generic items such as month/day names, etc.
 * See mw-messages.ts for the list of keys.
 */
function loadMediaWikiMessages() {
	return new mw.Api()
		.getMessages(MWMessages, {
			amlang: mw.config.get('wgContentLanguage'),
			// cache them, as messages are not going to change that often
			maxage: 99999999,
			smaxage: 99999999,
		})
		.then((mwMessages) => {
			loadMessages(mwMessages);
		});
}
