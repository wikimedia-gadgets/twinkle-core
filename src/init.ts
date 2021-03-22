import { arr_includes } from './utils';
import { initMessaging } from './messenger';
import { Twinkle } from './twinkle';
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

	// Parallelize API calls
	return $.when([loadUserConfig(), initMessaging()]).then(() => {
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

	// XXX: this is post-init hook
	// Hide the lingering space if the TW menu is empty
	if (mw.config.get('skin') === 'vector' && getPref('portletType') === 'menu' && $('#p-twinkle').length === 0) {
		$('#p-cactions').css('margin-right', 'initial');
	}
});
