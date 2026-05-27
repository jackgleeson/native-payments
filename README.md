# NativePayments

MediaWiki extension that triggers browser-native payment sheets (Google Pay / Apple Pay) and submits the resulting token to a payments-wiki's DonationInterface.

The extension renders no UI. Callers decide where and when to invoke a payment.

## Browser support

| Method | API used | Browsers |
|---|---|---|
| Google Pay | W3C [Payment Request](https://developer.mozilla.org/en-US/docs/Web/API/Payment_Request_API) | Chromium-based browsers where Google Pay via Payment Request is available (Chrome, Edge, Brave). |
| Apple Pay | Native [`ApplePaySession`](https://developer.apple.com/documentation/apple_pay_on_the_web) | Safari on macOS / iOS |

By default `pay()` dispatches to whichever API the current browser supports. Callers can pin a specific method with the `paymentMethod` option.

## JS API

`mw.nativePayments` exposes:

```js
mw.nativePayments.isSupported()           // true if either API is available
mw.nativePayments.canUseApplePay()        // true if ApplePaySession can make payments
mw.nativePayments.canUseGooglePay()       // true if PaymentRequest is available
mw.nativePayments.pay( options )          // fire payment sheet immediately
mw.nativePayments.attach( target, options ) // wire a click handler on target
```

`options`:

| Field | Type | Notes |
|---|---|---|
| `amount` | number \| string \| function | Required. Function form is evaluated at click time. |
| `paymentMethod` | `'apple'` \| `'google'` \| `'auto'` | Defaults to `'auto'` (prefers Apple Pay on Safari, Google Pay otherwise). Pin to `'google'` or `'apple'` when wiring a button labelled with a specific method. |
| `onSuccess` | function | Called with `{ amount, currency }` after a successful payment. |
| `successUrl` | string | If set, the page navigates here after `onSuccess` fires. |

Amount must satisfy `1 ≤ x ≤ 12000` in major units of the detected currency (from `navigator.language`). Invalid amounts make `pay()` a silent no-op.

## Samples

In any JS loaded on the page:

**Fixed amount, single button**:

```js
mw.loader.using( 'ext.nativePayments' ).then( () => {
    mw.nativePayments.attach( '#donate-25', { amount: 25 } );
} );
```

**Custom amount input, pinned to Google Pay**:

```js
mw.loader.using( 'ext.nativePayments' ).then( () => {
    const input = document.getElementById( 'donate-amount' );
    mw.nativePayments.attach( '#pay-google', {
        amount: () => input.value,
        paymentMethod: 'google',
        onSuccess: ( info ) => console.log( 'Donated', info.currency, info.amount )
    } );
} );
```

**Render only supported methods, then attach**:

```js
mw.loader.using( 'ext.nativePayments' ).then( () => {
    if ( mw.nativePayments.canUseApplePay() ) {
        document.getElementById( 'pay-apple' ).hidden = false;
        mw.nativePayments.attach( '#pay-apple', { amount: 25, paymentMethod: 'apple' } );
    }
    if ( mw.nativePayments.canUseGooglePay() ) {
        document.getElementById( 'pay-google' ).hidden = false;
        mw.nativePayments.attach( '#pay-google', { amount: 25, paymentMethod: 'google' } );
    }
} );
```

**Direct call** (caller handles the click):

```js
myButton.addEventListener( 'click', () => {
    mw.nativePayments.pay( {
        amount: parseFloat( input.value ),
        paymentMethod: 'google',
        successUrl: '/wiki/ThankYou'
    } );
} );
```

## Configuration

| Variable | Default | |
|---|---|---|
| `$wgNativePaymentsApiBase` | `""` | Base URL of the payments wiki. Empty string = same-origin install. |
| `$wgNativePaymentsEnableTestBanner` | `false` | Inject the bundled test fundraising banner via `SiteNoticeAfter`. Local prototyping only. |

## Installation

**Same-origin** — extension on the payments wiki, no CORS:

```php
wfLoadExtension( 'NativePayments' );
```

**Cross-origin** — extension on a core wiki:

```php
wfLoadExtension( 'NativePayments' );
$wgNativePaymentsApiBase = 'https://paymentstest1.wmcloud.org';
```

Cross-origin also requires the payments wiki to whitelist the core wiki's origin in `$wgCrossSiteAJAXdomains`:

```php
// In payments wiki's LocalSettings.php
$wgCrossSiteAJAXdomains = [
    'core.example.org',           // FR-Tech: 'paymentsipntest1.wmcloud.org'
    // 'localhost:9014',          // add if testing via localhost directly
];
```

Only the core wiki's origin is required. The payments wiki doesn't need to whitelist itself.

### Apple Pay domain validation

Apple Pay requires the wiki origin that loads `init.js` to serve `/.well-known/apple-developer-merchantid-domain-association`. The payments wiki already does for the existing `gravy.js` flow. A cross-origin install on a core wiki needs the same file on that origin.

## Payments-wiki side

Requires [DonationInterface](https://gerrit.wikimedia.org/g/mediawiki/extensions/DonationInterface) providing the `getNativePaymentConfig`, `di_donate_gravy`, and `di_applesession_gravy` actions.

## FR-Tech testing

Depends on the payments-wiki side patch: [gerrit 1289982](https://gerrit.wikimedia.org/r/c/mediawiki/extensions/DonationInterface/+/1289982) (adds the `getNativePaymentConfig` action to DonationInterface).

Set `$wgNativePaymentsEnableTestBanner = true;` on the core wiki to inject the bundled fundraising banner on view pages.

Tunnel from the fr-tech cloud bastion to your local docker stack, then load the two wiki URLs over the cloud hostnames:

```bash
ssh -vR 8001:localhost:9009 -R 8101:localhost:9014 payments-trixie.fr-tech-dev.eqiad1.wikimedia.cloud
```

| Wiki | URL |
|---|---|
| Payments | https://paymentstest1.wmcloud.org/index.php/Main_Page |
| Core | https://paymentsipntest1.wmcloud.org/index.php/Main_Page |

## Status

Prototype. End-to-end working against the sandbox.
