import { arr_includes } from './utils';
import { loadMessages } from './messenger';
import messages from './messages.json';
import { Twinkle } from './twinkle';
import MWMessages from './mw-messages';
import { getPref, loadUserConfig } from './Config';
import { setPortletConfig } from './portlet';

/**
 * Modules can be initialized only after this is resolved
 */
const ready = $.Deferred();

/**
 * Adds a callback to execute when Twinkle has loaded.
 * @param func
 * @param [name] - name of module used to check if is disabled.
 * If name is not given, module is loaded unconditionally.
 */
export function addInitCallback(func: () => void, name: string) {
	ready.then(() => {
		if (
			!name ||
			(!arr_includes(getPref('disabledModules'), name) && !arr_includes(getPref('disabledSysopModules'), name))
		) {
			func();
		}
	});
}

function loadMediaWikiMessages() {
	return new mw.Api()
		.getMessages(MWMessages, {
			amlang: mw.config.get('wgContentLanguage'),
			// cache them, as messages are not going to change that often
			maxage: 99999999,
			smaxage: 99999999,
		})
		.then((messages) => {
			loadMessages(messages);
		});
}

/**
 * Pre-requisites for initializing Twinkle
 */
export function init() {
	// Quick bail on special pages where no modules are active
	if (
		mw.config.get('wgNamespaceNumber') === -1 &&
		!arr_includes(Twinkle.activeSpecialPages, mw.config.get('wgCanonicalSpecialPageName'))
	) {
		return;
	}

	// Prevent clickjacking
	if (window.top !== window.self) {
		return;
	}

	// Set skin-specific configuration
	setPortletConfig();

	// Populate messages
	loadMessages(messages);

	$.when([loadUserConfig(), loadMediaWikiMessages()]).then(() => {
		ready.resolve();
	});
}

ready.then(() => {
	// Increases text size in Twinkle dialogs, if so configured
	if (getPref('dialogLargeFont')) {
		mw.util.addCSS(
			'.morebits-dialog-content, .morebits-dialog-footerlinks { font-size: 100% !important; } ' +
				'.morebits-dialog input, .morebits-dialog select, .morebits-dialog-content button { font-size: inherit !important; }'
		);
	}

	// Hide the lingering space if the TW menu is empty
	if (mw.config.get('skin') === 'vector' && getPref('portletType') === 'menu' && $('#p-twinkle').length === 0) {
		$('#p-cactions').css('margin-right', 'initial');
	}
});
