import { arr_includes } from './utils';
import { initMessaging } from './messenger';
import { Twinkle } from './twinkle';
import { Config, getPref, loadUserConfig } from './Config';
import { setPortletConfig } from './portlet';
import { registerModule } from './twinkleModule';

/**
 * List of names of modules disabled by user. Populated in init()
 * before modules are initialised.
 */
export let userDisabledModules: string[] = [];

/**
 * Initialise Twinkle. This must be called AFTER all configurations in
 * Twinkle.* and SiteConfig.* have been defined.
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

	Twinkle.preModuleInitHooks.push(
		// Get messages
		() => {
			initMessaging();
		},

		// Get user config and perform init actions that rely on the config
		() => {
			return loadUserConfig().then(() => {
				// Increases text size in Twinkle dialogs, if so configured
				if (getPref('dialogLargeFont')) {
					mw.util.addCSS(
						'.morebits-dialog-content, .morebits-dialog-footerlinks { font-size: 100% !important; } ' +
							'.morebits-dialog input, .morebits-dialog select, .morebits-dialog-content button { font-size: inherit !important; }'
					);
				}

				userDisabledModules = userDisabledModules.concat(getPref('disabledModules'), getPref('disabledSysopModules'));

				return Promise.all(Twinkle.preModuleInitHooksWithConfig.map((func) => func()));
			});
		}
	);

	Promise.all(Twinkle.preModuleInitHooks.map((func) => func())).then(() => {
		mw.hook('twinkle.preModuleInit').fire();

		for (let module of Twinkle.registeredModules) {
			registerModule(module);
		}

		// Hide the lingering space if the TW menu is empty
		if (mw.config.get('skin') === 'vector' && getPref('portletType') === 'menu' && $('#p-twinkle').length === 0) {
			$('#p-cactions').css('margin-right', 'initial');
		}

		// Has any effect only on WP:TWPREF
		Config.init();
	});
}
