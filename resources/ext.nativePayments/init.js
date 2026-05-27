/**
 * NativePayments — browser-native payment sheet integration (Google Pay via
 * W3C PaymentRequest, Apple Pay via ApplePaySession).
 *
 * Exposes mw.nativePayments.{ attach, pay, isSupported, canUseApplePay,
 * canUseGooglePay } so callers (buttons, links, other extensions) can wire
 * native Google Pay / Apple Pay to any element or trigger a payment.
 */
( function () {
	'use strict';

	const PAYMENTS_API_BASE = mw.config.get( 'wgNativePaymentsApiBase' ) || '';

	const COUNTRY_CURRENCY = {
		US: 'USD', CA: 'CAD', GB: 'GBP', AU: 'AUD', NZ: 'NZD',
		JP: 'JPY', EU: 'EUR', DE: 'EUR', FR: 'EUR', IT: 'EUR',
		ES: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', IE: 'EUR',
		PT: 'EUR', FI: 'EUR', LU: 'EUR', SE: 'SEK', NO: 'NOK',
		DK: 'DKK', CZ: 'CZK', PL: 'PLN', CH: 'CHF', IN: 'INR',
		BR: 'BRL', MX: 'MXN', ZA: 'ZAR', IL: 'ILS'
	};

	const LIMITS = { min: 1, max: 12000 };

	const detectCountry = () => {
		const lang = navigator.language || navigator.userLanguage || 'en-US';
		const parts = lang.split( '-' );
		return parts.length > 1 ? parts[ parts.length - 1 ].toUpperCase() : 'US';
	};

	const detectedCountry = detectCountry();
	const currency = COUNTRY_CURRENCY[ detectedCountry ] || 'USD';

	// Cross-origin POST helper for payments-wiki API calls.
	const parseJsonResponse = ( resp ) => {
		if ( !resp.ok ) {
			throw new Error( `HTTP ${ resp.status }` );
		}
		return resp.json();
	};

	// origin= triggers MW's CORS path and is rejected on same-origin installs,
	// so only attach it when actually crossing origins.
	const apiUrl = () => {
		if ( PAYMENTS_API_BASE ) {
			return `${ PAYMENTS_API_BASE }/api.php?origin=${ encodeURIComponent( window.location.origin ) }`;
		}
		return '/api.php';
	};

	const postToPayments = ( params ) => fetch( apiUrl(), {
		method: 'POST',
		credentials: 'include',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams( params ).toString()
	} ).then( parseJsonResponse );

	// Payments config — fetched once from payments-wiki, cached.
	let paymentsConfigPromise = null;

	const fetchPaymentsConfig = () => {
		if ( paymentsConfigPromise ) {
			return paymentsConfigPromise;
		}
		const query = new URLSearchParams( {
			action: 'getNativePaymentConfig',
			gateway: 'gravy',
			payment_method: 'google',
			country: detectedCountry,
			currency: currency,
			format: 'json'
		} );
		if ( PAYMENTS_API_BASE ) {
			query.set( 'origin', window.location.origin );
		}
		paymentsConfigPromise = fetch( `${ PAYMENTS_API_BASE }/api.php?${ query }`, { credentials: 'omit' } )
			.then( parseJsonResponse )
			.then( ( data ) => {
				if ( !data?.config ) {
					throw new Error( 'Missing config in response' );
				}
				return data.config;
			} )
			.catch( ( err ) => {
				// Don't pin the failure forever — allow retry on next call.
				paymentsConfigPromise = null;
				throw err;
			} );
		return paymentsConfigPromise;
	};

	// Strict: whole digits, optional 1–2 decimal places. Returns null on invalid.
	const parseAmount = ( amount ) => {
		const value = String( amount ?? '' ).trim();
		return /^\d+(?:\.\d{1,2})?$/.test( value ) ? Number( value ) : null;
	};

	const validateAmount = ( amount ) => {
		const num = parseAmount( amount );
		return num !== null && num >= LIMITS.min && num <= LIMITS.max;
	};

	// Payment Request method construction.
	const buildGooglePayMethod = ( amount, config ) => ( {
		supportedMethods: 'https://google.com/pay',
		data: {
			environment: config.googleEnvironment,
			apiVersion: 2,
			apiVersionMinor: 0,
			merchantInfo: {
				merchantName: 'Wikimedia Foundation',
				merchantId: config.googleMerchantId
			},
			allowedPaymentMethods: [ {
				type: 'CARD',
				parameters: {
					allowedAuthMethods: [ 'PAN_ONLY', 'CRYPTOGRAM_3DS' ],
					allowedCardNetworks: config.googleAllowedNetworks,
					billingAddressRequired: true,
					billingAddressParameters: { format: 'FULL' }
				},
				tokenizationSpecification: {
					type: 'PAYMENT_GATEWAY',
					parameters: {
						gateway: 'gr4vy',
						gatewayMerchantId: config.gravyGooglePayMerchantId
					}
				}
			} ],
			transactionInfo: {
				totalPriceStatus: 'FINAL',
				totalPrice: amount,
				currencyCode: currency,
				countryCode: detectedCountry
			},
			emailRequired: true
		}
	} );

	const buildApplePayRequest = ( amount ) => ( {
		countryCode: detectedCountry,
		currencyCode: currency,
		merchantCapabilities: [ 'supportsCredit', 'supportsDebit', 'supports3DS' ],
		supportedNetworks: [ 'visa', 'masterCard', 'amex', 'discover' ],
		requiredBillingContactFields: [ 'email', 'name', 'postalAddress' ],
		requiredShippingContactFields: [ 'email', 'name' ],
		total: {
			label: 'Wikimedia Foundation',
			type: 'final',
			amount: amount
		}
	} );

	const extractGooglePayData = ( details ) => {
		const paymentMethodData = details.paymentMethodData ?? details;
		const { tokenizationData = {}, info = {} } = paymentMethodData;
		const { billingAddress: billing = {} } = info;

		return {
			payment_token: tokenizationData.token || '',
			card_suffix: info.cardDetails || '',
			card_scheme: info.cardNetwork || '',
			full_name: billing.name || '',
			email: details.email || '',
			street_address: billing.address1 || '',
			city: billing.locality || '',
			state_province: billing.administrativeArea || '',
			postal_code: billing.postalCode || '',
			country: billing.countryCode || detectedCountry,
			payment_method: 'google',
			payment_submethod: ( info.cardNetwork || '' ).toLowerCase()
		};
	};

	const extractApplePayData = ( details ) => {
		const { token = {}, billingContact = {}, shippingContact = {} } = details;
		const { paymentMethod = {} } = token;

		const nameContact = ( billingContact.givenName || billingContact.familyName ) ? billingContact :
			( shippingContact.givenName || shippingContact.familyName ) ? shippingContact : {};
		const addressLines = billingContact.addressLines || [];

		return {
			payment_token: JSON.stringify( token ),
			first_name: nameContact.givenName || '',
			last_name: nameContact.familyName || '',
			email: shippingContact.emailAddress || billingContact.emailAddress || '',
			street_address: addressLines[ 0 ] || '',
			city: billingContact.locality || '',
			state_province: billingContact.administrativeArea || '',
			postal_code: billingContact.postalCode || '',
			country: billingContact.countryCode || detectedCountry,
			payment_method: 'apple',
			payment_submethod: ( paymentMethod.network || '' ).toLowerCase()
		};
	};

	// API calls to payments-wiki.
	const submitToPaymentsWiki = ( donorData, amount ) => postToPayments( {
		action: 'di_donate_gravy',
		gateway: 'gravy',
		currency: currency,
		amount: amount,
		language: ( navigator.language || 'en' ).split( '-' )[ 0 ],
		country: detectedCountry,
		utm_source: 'NativePayments',
		utm_medium: 'sitenotice',
		format: 'json',
		...donorData
	} ).then( ( data ) => data?.result?.isFailed === false );

	const validateAppleMerchant = ( validationURL ) => postToPayments( {
		action: 'di_applesession_gravy',
		validation_url: validationURL,
		format: 'json'
	} ).then( ( data ) => data.session );

	// Format amount for the payment sheet — JPY has no minor units.
	const formatAmount = ( amount ) => {
		const num = parseAmount( amount );
		return currency === 'JPY' ? String( Math.round( num ) ) : num.toFixed( 2 );
	};

	const handleSuccess = ( options, formattedAmount ) => {
		options.onSuccess?.( { amount: formattedAmount, currency: currency } );
		if ( options.successUrl ) {
			window.location.href = options.successUrl;
		}
	};

	// Apple Pay path — Safari only. Uses ApplePaySession directly; merchant
	// identification happens server-side during merchant validation.
	const payViaApplePay = ( options ) => {
		const formattedAmount = formatAmount( options.amount );
		const session = new ApplePaySession( 3, buildApplePayRequest( formattedAmount ) );

		session.onvalidatemerchant = ( event ) => {
			validateAppleMerchant( event.validationURL )
				.then( ( merchantSession ) => session.completeMerchantValidation( merchantSession ) )
				.catch( ( err ) => {
					mw.log.warn( '[NativePayments] Apple Pay merchant validation failed', err );
					session.abort();
				} );
		};

		session.onpaymentauthorized = ( event ) => {
			const donorData = extractApplePayData( event.payment );
			submitToPaymentsWiki( donorData, formattedAmount )
				.then( ( success ) => {
					session.completePayment( {
						status: success ? ApplePaySession.STATUS_SUCCESS : ApplePaySession.STATUS_FAILURE
					} );
					if ( success ) {
						handleSuccess( options, formattedAmount );
					}
				} )
				.catch( ( err ) => {
					mw.log.warn( '[NativePayments] Apple Pay authorization failed', err );
					session.completePayment( { status: ApplePaySession.STATUS_FAILURE } );
				} );
		};

		session.oncancel = () => {
			// User cancelled — nothing to do.
		};

		session.begin();
	};

	// Google Pay path — W3C PaymentRequest API.
	const payViaPaymentRequest = async ( options ) => {
		try {
			const config = await fetchPaymentsConfig();
			const formattedAmount = formatAmount( options.amount );

			const request = new PaymentRequest(
				[ buildGooglePayMethod( formattedAmount, config ) ],
				{
					total: {
						label: 'Wikimedia Foundation',
						amount: { currency: currency, value: formattedAmount }
					}
				}
			);

			if ( !( await request.canMakePayment() ) ) {
				return;
			}

			const response = await request.show();
			const donorData = extractGooglePayData( response.details );
			const success = await submitToPaymentsWiki( donorData, formattedAmount );
			await response.complete( success ? 'success' : 'fail' );

			if ( success ) {
				handleSuccess( options, formattedAmount );
			}
		} catch ( err ) {
			// Config fetch, user cancellation, or sheet/network error.
			// The browser sheet shows its own messaging where appropriate.
			mw.log.warn( '[NativePayments] pay() error', err );
		}
	};

	const canUseApplePay = () => !!( window.ApplePaySession && ApplePaySession.canMakePayments() );
	const canUseGooglePay = () => !!window.PaymentRequest;

	// Public: pay( { amount, paymentMethod, onSuccess, successUrl } )
	// paymentMethod: 'apple' | 'google' | 'auto' (default). 'auto' prefers Apple
	// Pay on Safari, Google Pay otherwise.
	const pay = ( options ) => {
		const amount = options?.amount;
		if ( !validateAmount( amount ) ) {
			mw.log.warn( '[NativePayments] pay() bailed: invalid amount', amount );
			return;
		}

		const method = options.paymentMethod || 'auto';

		if ( method === 'apple' ) {
			if ( canUseApplePay() ) {
				payViaApplePay( options );
			} else {
				mw.log.warn( '[NativePayments] Apple Pay requested but not supported.' );
			}
			return;
		}

		if ( method === 'google' ) {
			if ( canUseGooglePay() ) {
				payViaPaymentRequest( options );
			} else {
				mw.log.warn( '[NativePayments] Google Pay requested but not supported.' );
			}
			return;
		}

		// 'auto'
		if ( canUseApplePay() ) {
			payViaApplePay( options );
			return;
		}
		if ( canUseGooglePay() ) {
			payViaPaymentRequest( options );
			return;
		}
		mw.log.warn( '[NativePayments] No supported payment API in this browser.' );
	};

	// Public: attach( selectorOrEl, { amount, paymentMethod, onSuccess, successUrl } )
	const attach = ( selectorOrEl, options ) => {
		const el = typeof selectorOrEl === 'string' ?
			document.querySelector( selectorOrEl ) :
			selectorOrEl;
		if ( !el || !options ) {
			return;
		}
		el.addEventListener( 'click', ( e ) => {
			e.preventDefault();
			const amount = typeof options.amount === 'function' ? options.amount() : options.amount;
			pay( {
				amount: amount,
				paymentMethod: options.paymentMethod,
				onSuccess: options.onSuccess,
				successUrl: options.successUrl
			} );
		} );
	};

	// Expose public API. isSupported / canUseApplePay / canUseGooglePay are
	// functions (not snapshots) since Apple Pay availability can depend on
	// active card and device state.
	mw.nativePayments = {
		attach: attach,
		pay: pay,
		isSupported: () => canUseApplePay() || canUseGooglePay(),
		canUseApplePay: canUseApplePay,
		canUseGooglePay: canUseGooglePay
	};

	// Legacy banner auto-wiring — remove once banner.html stops being
	// injected by SiteNoticeAfter and real callers use attach() directly.
	const getBannerAmount = () => {
		const radio = document.querySelector( 'input[name="amount"]:checked' );
		if ( !radio ) {
			return null;
		}
		if ( radio.value === 'Other' ) {
			const other = document.getElementById( 'frb-amt-other-input' );
			return other?.value || null;
		}
		return radio.value;
	};

	const logTestSuccess = ( info ) => {
		mw.log( '[NativePayments] payment successful:', info );
	};

	const showTestToast = ( info ) => {
		const toast = document.createElement( 'div' );
		toast.textContent = `Thank you for your ${ info.currency } ${ info.amount } donation!`;
		toast.style.cssText = `
			position:fixed; top:0; left:0; right:0; z-index:10001;
			padding:14px 20px; background:#14866d; color:#fff;
			font:600 15px sans-serif; text-align:center;
			transform:translateY(-100%); transition:transform .3s ease;
		`;
		document.body.appendChild( toast );
		requestAnimationFrame( () => {
			toast.style.transform = 'translateY(0)';
		} );
		setTimeout( () => {
			toast.style.transform = 'translateY(-100%)';
			setTimeout( () => toast.remove(), 300 );
		}, 5000 );
	};

	const onTestSuccess = ( info ) => {
		logTestSuccess( info );
		showTestToast( info );
	};

	const wireBanner = () => {
		// Whole-button wrappers for the native payment tiles. Each tile is pinned to
		// its own method so clicking the Apple tile on Chrome (or vice versa) bails
		// rather than launching the wrong sheet.
		const googleBtn = document.querySelector( '.frb-pm-google' );
		if ( googleBtn ) {
			attach( googleBtn, {
				amount: getBannerAmount,
				paymentMethod: 'google',
				onSuccess: onTestSuccess
			} );
		}
		const appleBtn = document.querySelector( '.frb-pm-applepay' );
		if ( appleBtn ) {
			attach( appleBtn, {
				amount: getBannerAmount,
				paymentMethod: 'apple',
				onSuccess: onTestSuccess
			} );
		}
	};

	const onReady = () => {
		// Only Google Pay needs config from payments-wiki; skip the fetch on
		// Apple-only browsers to avoid wasted requests and noisy CORS errors.
		if ( canUseGooglePay() ) {
			fetchPaymentsConfig();
		}
		wireBanner();
	};

	if ( canUseApplePay() || canUseGooglePay() ) {
		if ( document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', onReady );
		} else {
			onReady();
		}
	}
}() );
