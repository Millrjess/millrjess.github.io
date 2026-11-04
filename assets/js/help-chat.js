(function(){
  var answers=[
    {k:["price","cost","fee","charge","rate"],a:"Care plans are $150 per month for Essential and $300 per month for Professional, with two months at no charge when paid annually. One time services start from $500 for a Site Health Audit and from $750 for a Website Standards Pass or a WCAG Accessibility Audit. See the full fee schedule for every price."},
    {k:["book","consultation","session","appointment"],a:"Book on the booking page. A 15 minute discovery call is complimentary. A 1 hour strategy session is $200, paid in advance at booking. I approve every booking before it is confirmed. If we cannot find a time that works, or I do not approve the booking, you will be refunded."},
    {k:["free"],a:"The 15 minute discovery call is complimentary, with no charge and no obligation. It is a phone or video call to discuss your website, your goals, and the problem you want to solve."},
    {k:["200","paid","pay","stripe","refund"],a:"A 1 hour strategy session is $200, paid in advance through Stripe, with a receipt. No session starts until payment is received. Pay to reserve your session, then choose your time. I approve every booking before it is confirmed. If we cannot find a time that works, or I do not approve the booking, you will be refunded."},
    {k:["care plan","maintenance","support","monthly"],a:"Essential, $150 per month, includes CMS updates, daily off site backups, uptime monitoring, and a monthly site health report. Professional, $300 per month, adds security hardening and malware scanning, performance checks, one hour of content or design tweaks, and priority support."},
    {k:["audit","health"],a:"A Site Health Audit starts from $500 and reviews technical SEO, security configuration, and website performance, with a prioritized action plan."},
    {k:["seo"],a:"Technical SEO starts from $1,000. Work may include structured data, crawl and indexing fixes, page speed improvements, and GA4 measurement setup. Search rankings are not guaranteed."},
    {k:["accessib","wcag"],a:"A WCAG Accessibility Audit and Remediation starts from $750, with prioritized fixes to meet WCAG 2.1 AA, the legal benchmark version. A Website Standards Pass starts from $750 and corrects against WCAG 2.2 AA, the practice standard."},
    {k:["malware","hacked","security"],a:"Malware Removal and Incident Response starts from $500 per incident, including investigation, cleanup, vulnerability remediation, and security hardening within the agreed scope."},
    {k:["location","where","boston","andover","remote","onsite","zoom"],a:"Based in North Andover, MA 01845, serving Boston, Greater Boston's North Shore, and the Merrimack Valley, plus remote clients nationwide. Sessions are on Zoom, nationwide, and onsite by arrangement in Boston, Greater Boston's North Shore, and the Merrimack Valley, including the Andovers."},
    {k:["wordpress","drupal","joomla","platform"],a:"Ongoing care covers WordPress, Drupal, Joomla, and custom database driven websites."},
    {k:["start","begin","contact","email","phone"],a:"Start on the booking page, or email millrjess@gmail.com, or call (978) 267-5304. I read and reply to every inquiry personally."},
    {k:["agent","website agent","chatbot"],a:"Website Agents start from $2,500, for lead qualification, customer support, data processing, and multi step workflows. Integrations, permitted actions, and human review requirements are defined before development begins."}
  ];
  function find(q){
    q=q.toLowerCase();
    for(var i=0;i<answers.length;i++){
      for(var j=0;j<answers[i].k.length;j++){
        if(q.indexOf(answers[i].k[j])>-1) return answers[i].a;
      }
    }
    return "I do not have a published answer for that. Please email millrjess@gmail.com, call (978) 267-5304, or use the booking page, and Jessica will reply personally. I cannot confirm a booking, change a price, or start work in this chat.";
  }
  var btn=document.createElement("button");
  btn.textContent="Ask a question";
  btn.setAttribute("aria-label","Open help chat");
  btn.style.cssText="position:fixed;right:20px;bottom:20px;z-index:100;background:#f0dfae;color:#0b1a30;border:2px solid #0b1a30;border-radius:999px;padding:.7em 1.2em;font-weight:700;cursor:pointer;box-shadow:0 10px 22px -8px rgba(15,35,64,.35);font-family:inherit";
  var panel=document.createElement("div");
  panel.style.cssText="display:none;position:fixed;right:20px;bottom:76px;z-index:100;width:320px;max-width:calc(100vw - 40px);background:#fff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 14px 34px -18px rgba(15,35,64,.22);padding:16px;font-family:inherit;color:#334155";
  panel.innerHTML="<div style='display:flex;justify-content:space-between;align-items:flex-start;gap:12px'><p style='margin:0;color:#0f2340;font-weight:700'>Help chat, AI helper</p><button id='hc-close' aria-label='Close help chat' style='background:none;border:0;font-size:1.2em;line-height:1;cursor:pointer;color:#0b1a30;padding:0 2px'>X</button></div><p style='margin:0 0 12px;font-size:.9em'>I am an AI helper, not Jessica. I can only answer from published services, prices, and booking information. I cannot confirm a booking, change a price, or start work.</p><div id='hc-log' style='font-size:.95em'></div><div style='display:flex;gap:8px;margin-top:12px'><input id='hc-q' type='text' placeholder='Ask about prices or booking' style='flex:1;padding:.6em;border:1px solid #e2e8f0;border-radius:10px;font:inherit'><button id='hc-send' style='background:#0b1a30;color:#fff;border:0;border-radius:10px;padding:.6em 1em;cursor:pointer;font:inherit'>Ask</button></div><p style='font-size:.85em;color:#64748b;margin:12px 0 0'>Try: How much is a strategy session? How do I book? What is in a care plan?</p>";
  document.body.appendChild(btn); document.body.appendChild(panel);
  function ask(){
    var inp=document.getElementById("hc-q"); var q=inp.value.trim(); if(!q) return;
    var log=document.getElementById("hc-log");
    var d=document.createElement("div"); d.innerHTML="<p style='margin:8px 0'><strong>You:</strong> "+q.replace(/</g,"&lt;")+"</p><p style='margin:8px 0'>"+find(q)+"</p>"; log.appendChild(d); inp.value="";
  }
  btn.onclick=function(){ panel.style.display = panel.style.display==="none" ? "block" : "none"; };
  document.getElementById("hc-close").onclick=function(){ panel.style.display="none"; };
  document.getElementById("hc-send").onclick=ask;
  document.getElementById("hc-q").addEventListener("keydown", function(e){ if(e.key==="Enter") ask(); });
})();
