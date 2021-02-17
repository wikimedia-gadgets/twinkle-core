import Banana, { Messages } from 'orange-i18n';

let banana = new Banana(mw.config.get('wgContentLanguage'));

export function loadMessages(messages: Messages) {
	banana.load(messages, mw.config.get('wgContentLanguage'));
}
export function msg(msg: string, ...parameters: (string | number)[]) {
	return banana.i18n(msg, ...parameters);
}
