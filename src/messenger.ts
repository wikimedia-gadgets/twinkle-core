import Banana, { Messages } from 'orange-i18n';
import messages from '../i18n/en.json';
import MWMessages from './mw-messages';

let banana = new Banana(mw.config.get('wgContentLanguage'));

banana.registerParserPlugin('date', (nodes) => {
	// Check if it's already Date or Morebits.date object
	// otherwise assume we can construct a Morebits.date
	// out of it
	let mbDate =
		typeof nodes[0].getTime === 'function' ? new Morebits.date(nodes[0].getTime()) : new Morebits.date(nodes[0]);

	let format = nodes[1];
	// XXX: Don't assume the wiki's timezone is UTC
	let zone: 'utc' | undefined = nodes[2] === 'utc' ? 'utc' : undefined;
	if (format === 'relative') {
		return mbDate.calendar(zone);
	} else {
		return mbDate.format(format, zone);
	}
});

banana.registerParserPlugin('sysop', (nodes) => {
	return Morebits.userIsSysop ? nodes[1] : nodes[2];
});

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
	loadMessages(messages as Messages);

	// Set Morebits i18n
	Morebits.i18n.setParser({ get: msg });

	// Load MW messages and return the promise
	return loadMediaWikiMessages();
}

/**
 * Load the messages available in MediaWiki using the API.
 * These will include generic items such as month/day names, etc.
 * See mw-messages.ts for the list of keys.
 * TODO: messages in per-wiki config should override these MW messages,
 * not the other way round
 */
function loadMediaWikiMessages() {
	let promises = [];
	for (let i = 0; i < MWMessages.length; i += 50) {
		promises.push(
			// Mediawiki namespace-based overrides of MW messages do get taken
			// into account
			new mw.Api()
				.getMessages(MWMessages.slice(i, i + 50), {
					amlang: mw.config.get('wgContentLanguage'),
					// cache them, as messages are not going to change that often
					maxage: 31536000, // 1 year
					smaxage: 31536000,
					// uselang enables public caching, see https://phabricator.wikimedia.org/T97096
					uselang: 'content',
				})
				.then((mwMessages) => {
					loadMessages(mwMessages);
				})
		);
	}
	return $.when.apply(null, promises);
}

/**
 * Load messages from a web address.
 * @param url
 */
export function loadMessagesFromWeb(url) {
	return $.getJSON(url).then((data) => loadMessages(data));
	// XXX: this code better handles caching, but is giving CORS issue
	// $.ajax({
	// 	url: url,
	// 	dataType: 'json',
	// 	cache: true,
	// 	headers: {
	// 		'Cache-Control': 'max-age=864000', // 10 days
	// 	},
	// }).then((data) => {
	// 	loadMessages(JSON.parse(data));
	// });
}
