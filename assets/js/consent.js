/* Analytics consent. Google Analytics loads with storage denied until the visitor accepts. The choice is stored on the device. */
(function(){
  var KEY = 'ga-consent';
  function stored(){ try { return window.localStorage.getItem(KEY); } catch (e) { return null; } }
  function save(value){ try { window.localStorage.setItem(KEY, value); } catch (e) {} }
  function hideBanner(){
    var banner = document.getElementById('analytics-consent');
    if (banner) banner.remove();
  }
  function grant(){
    save('granted');
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {analytics_storage: 'granted'});
    }
    hideBanner();
  }
  function decline(){
    save('denied');
    hideBanner();
  }
  function showBanner(){
    if (document.getElementById('analytics-consent')) return;
    var style = document.createElement('style');
    style.textContent = '#analytics-consent{position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#fdfbf7;color:#0b1a30;border-top:2px solid #0b1a30;padding:14px 16px;font-family:Inter,system-ui,sans-serif;font-size:15px;line-height:1.5;box-shadow:0 -2px 12px rgba(11,26,48,.18)}#analytics-consent p{margin:0 0 10px;max-width:720px}#analytics-consent .consent-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}#analytics-consent button{cursor:pointer;border:0;border-radius:6px;padding:9px 18px;font-size:15px;font-weight:600}#analytics-consent .consent-accept{background:#0b1a30;color:#fff}#analytics-consent .consent-decline{background:transparent;color:#0b1a30;box-shadow:inset 0 0 0 1px #0b1a30}#analytics-consent a{color:#0b1a30}';
    document.head.appendChild(style);
    var banner = document.createElement('div');
    banner.id = 'analytics-consent';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Analytics consent');
    banner.innerHTML = '<p>This site uses Google Analytics to understand visits in aggregate. No personal information is collected. <a href="/privacy-policy/">Read the privacy policy</a>.</p><div class="consent-actions"><button type="button" class="consent-accept">Accept</button><button type="button" class="consent-decline">Decline</button></div>';
    banner.querySelector('.consent-accept').addEventListener('click', grant);
    banner.querySelector('.consent-decline').addEventListener('click', decline);
    document.body.appendChild(banner);
  }
  window.resetAnalyticsConsent = function(){
    try { window.localStorage.removeItem(KEY); } catch (e) {}
    showBanner();
  };
  var choice = stored();
  if (choice === 'granted') {
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', {analytics_storage: 'granted'});
    }
  } else if (choice !== 'denied') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showBanner);
    } else {
      showBanner();
    }
  }
})();
