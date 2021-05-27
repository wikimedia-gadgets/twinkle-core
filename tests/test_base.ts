import 'mock-mediawiki';

require(__dirname + '/../morebits/morebits');
global.Morebits = window.Morebits;

// @ts-ignore
mw.libs.pluralRuleParser = require('cldrpluralruleparser');

// Stubs:

// TODO: move to mock-mediawiki
// @ts-ignore
mw.Api = class {
	constructor(options) {
		var defaultOptions = {
			parameters: {
				action: 'query',
				format: 'json',
			},
			ajax: {
				url: mw.util.wikiScript('api'),
				timeout: 30 * 1000,
				dataType: 'json',
			},
		};

		var defaults = $.extend({}, options),
			setsUrl = options && options.ajax && options.ajax.url !== undefined;
		defaults.parameters = $.extend({}, defaultOptions.parameters, defaults.parameters);
		defaults.ajax = $.extend({}, defaultOptions.ajax, defaults.ajax);
		if (setsUrl) {
			defaults.ajax.url = String(defaults.ajax.url);
		}
		if (defaults.useUS === undefined) {
			defaults.useUS = !setsUrl;
		}
		this.defaults = defaults;
		this.requests = [];
	}
	getMessages() {
		return Promise.resolve({});
	}
};
