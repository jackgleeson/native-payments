<?php

namespace MediaWiki\Extension\NativePayments;

use MediaWiki\Output\OutputPage;
use Skin;

class Hooks {

	/**
	 * Inject the NativePayments module and config vars on every page.
	 *
	 * @param OutputPage $out
	 * @param Skin $skin
	 */
	public static function onBeforePageDisplay( OutputPage $out, Skin $skin ): void {
		$out->addJsConfigVars( [
			'wgNativePaymentsApiBase' => $out->getConfig()->get( 'NativePaymentsApiBase' ),
		] );
		$out->addModules( 'ext.nativePayments' );
	}

	/**
	 * Inject the fundraising banner via the site notice for local testing.
	 * Temporary: real callers will use mw.nativePayments.attach() against
	 * their own elements, and the banner will be rendered by CentralNotice
	 * or a banner template rather than baked into this extension.
	 *
	 * @param string &$siteNotice
	 * @param Skin $skin
	 * @return bool
	 */
	public static function onSiteNoticeAfter( string &$siteNotice, Skin $skin ): bool {
		if ( !$skin->getConfig()->get( 'NativePaymentsEnableTestBanner' ) ) {
			return true;
		}

		$action = $skin->getRequest()->getVal( 'action', 'view' );
		if ( $action !== 'view' ) {
			return true;
		}

		// Skip Special pages — avoids colliding with the payments wiki's own
		// Special:Donate form when this extension is installed same-origin.
		$title = $skin->getTitle();
		if ( $title && $title->isSpecialPage() ) {
			return true;
		}

		$bannerPath = __DIR__ . '/../resources/banner.html';
		if ( file_exists( $bannerPath ) ) {
			$siteNotice .= file_get_contents( $bannerPath );
		}
		return true;
	}
}
