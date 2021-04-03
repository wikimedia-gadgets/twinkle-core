import Banana, { Messages } from 'orange-i18n';
import messages from '../i18n/en.json';
import MWMessageList from './mw-messages';
import { obj_entries, obj_fromEntries, urlParamValue } from './utils';

/**
 * Orange-i18n object
 */
let banana;

/**
 * The language used for all messages in twinkle-core.
 * This includes interface messages as well as edits made to the wiki.
 * Ideally the interface messages should have been in wgUserLanguage
 * and edits in wgContentLanguage, but this duality is not presently
 * supported.
 */
export let language = urlParamValue('uselang') || mw.config.get('wgContentLanguage');

const i18nParserPlugins = {
	date(nodes) {
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
	},

	// Embedded messages
	int(nodes) {
		let msgName = nodes[0],
			msgParams = nodes.slice(1);
		return msg(msgName, ...msgParams);
	},

	// Adapted from mediawiki.jqueryMsg
	ns(nodes) {
		var ns = String(nodes[0]).trim();
		if (!/^\d+$/.test(ns)) {
			ns = mw.config.get('wgNamespaceIds')[ns.replace(/ /g, '_').toLowerCase()];
		}
		ns = mw.config.get('wgFormattedNamespaces')[ns];
		return ns || '';
	},

	ucfirst(nodes) {
		return Morebits.string.toUpperCaseFirstChar(nodes[0]);
	},

	lcfirst(nodes) {
		return Morebits.string.toLowerCaseFirstChar(nodes[0]);
	},

	list(nodes) {
		let list = nodes[0];
		let text = '';
		for (let i = 0; i < list.length; i++) {
			text += list[i];
			if (list.length - 2 === i) {
				text += msg('and') + msg('word-separator');
			} else if (list.length - 1 !== i) {
				text += msg('comma-separator');
			}
		}
		return text;
	},

	// Experimental
	sysop(nodes) {
		return Morebits.userIsSysop ? nodes[1] : nodes[2];
	},
};

/**
 * Load messages into the message store.
 * @param messages
 */
export function addMessages(messages: Messages) {
	banana.load(messages, language);
}

/**
 * Get parsed message.
 * @param msg - the message name
 * @param parameters - the parameters for $1, $2, ... substitutions
 */
export function msg(msg: string, ...parameters: (string | number | string[])[]) {
	if (!banana) {
		// this will come up when msg() is accidentally used at the top level of code
		// when the messages wouldn't have loaded
		throw new Error("Can't emit messages before initMessaging() has run!");
	}
	return banana.i18n(msg, ...parameters);
}

/**
 * Initialize the message store. Called from init.ts.
 */
export function initMessaging() {
	banana = new Banana(language);

	// QQX is a dummy "language" for documenting messages
	if (language === 'qqx') {
		// the *names* of the messages within parentheses are populated as the messages
		addMessages(obj_fromEntries(Object.keys(messages).map((msg) => [msg, '(' + msg + ')'])));
	} else {
		// Populate default English messages, XXX: should we do this?
		addMessages(messages);
	}

	// Register plugins
	obj_entries(i18nParserPlugins).forEach(([name, plugin]) => {
		banana.registerParserPlugin(name, plugin);
	});

	// Set Morebits i18n
	Morebits.i18n.setParser({ get: msg });

	// Load MW messages and return the promise
	return loadMediaWikiMessages(MWMessageList);
}

/**
 * Load the messages available in MediaWiki using the API.
 * These will include generic items such as month/day names, etc.
 * See mw-messages.ts for the list of keys.
 */
function loadMediaWikiMessages(msgList: string[]) {
	let promises = [];
	for (let i = 0; i < msgList.length; i += 50) {
		promises.push(
			// Mediawiki namespace-based overrides of MW messages do get taken
			// into account
			new mw.Api()
				.getMessages(msgList.slice(i, i + 50), {
					amlang: language,
					// cache them, as messages are not going to change that often
					maxage: 31536000, // 1 year
					smaxage: 31536000,
					// uselang enables public caching, see https://phabricator.wikimedia.org/T97096
					uselang: 'content',
				})
				.then((msgsFromApi) => {
					addMessages(msgsFromApi);
				})
		);
	}
	return $.when.apply(null, promises);
}

/**
 * Load messages from MediaWiki, in addition to what twinkle-core loads.
 * @param messageList
 */
export function loadAdditionalMediaWikiMessages(messageList: string[]) {
	return loadMediaWikiMessages(messageList);
}

/**
 * Load messages from a web address.
 * @param url
 */
export function loadMessagesFromWeb(url) {
	return $.getJSON(url).then((data) => addMessages(data));
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
