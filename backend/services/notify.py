"""
Notification service — SMS via Twilio, Email via Resend.
Designed to be extended with APNs push notifications for the future iPhone app.
"""

import logging
from datetime import datetime
from config import get_settings

logger = logging.getLogger(__name__)


def _format_estimate_message(estimate: dict, lead: dict) -> str:
    low = estimate.get("estimate_low", 0)
    high = estimate.get("estimate_high", 0)
    service = estimate.get("service_type", "").replace("_", " ").title()
    address = lead.get("address", "Unknown address")
    estimate_id = estimate.get("id", "")
    settings = get_settings()
    link = f"{settings.frontend_url}/estimates/{estimate_id}"
    return (
        f"New {service} estimate pending your approval.\n"
        f"Address: {address}\n"
        f"Range: ${low:,.0f}–${high:,.0f}\n"
        f"Review: {link}"
    )


def send_sms_to_owner(estimate: dict, lead: dict) -> bool:
    settings = get_settings()
    if not all([settings.twilio_account_sid, settings.twilio_auth_token,
                settings.twilio_from_number, settings.owner_phone]):
        logger.warning("Twilio not configured — skipping SMS")
        return False

    try:
        from twilio.rest import Client
        client = Client(settings.twilio_account_sid, settings.twilio_auth_token)
        message = _format_estimate_message(estimate, lead)
        client.messages.create(
            body=message,
            from_=settings.twilio_from_number,
            to=settings.owner_phone,
        )
        logger.info(f"SMS sent to owner for estimate {estimate.get('id')}")
        return True
    except Exception as e:
        logger.error(f"SMS failed: {e}")
        return False


def send_email_to_owner(estimate: dict, lead: dict) -> bool:
    settings = get_settings()
    if not all([settings.resend_api_key, settings.owner_email]):
        logger.warning("Resend not configured — skipping email")
        return False

    try:
        import resend
        resend.api_key = settings.resend_api_key

        low = estimate.get("estimate_low", 0)
        high = estimate.get("estimate_high", 0)
        service = estimate.get("service_type", "").replace("_", " ").title()
        address = lead.get("address", "Unknown address")
        estimate_id = estimate.get("id", "")
        link = f"{settings.frontend_url}/estimates/{estimate_id}"

        resend.Emails.send({
            "from": f"Dashboard <noreply@{settings.owner_email.split('@')[-1]}>",
            "to": settings.owner_email,
            "subject": f"[Action Required] New {service} Estimate — {address}",
            "html": f"""
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
              <h2 style="color:#1d4ed8">New Estimate Pending Approval</h2>
              <table style="width:100%;border-collapse:collapse">
                <tr><td style="padding:8px 0;color:#6b7280">Service</td>
                    <td style="padding:8px 0;font-weight:600">{service}</td></tr>
                <tr><td style="padding:8px 0;color:#6b7280">Address</td>
                    <td style="padding:8px 0;font-weight:600">{address}</td></tr>
                <tr><td style="padding:8px 0;color:#6b7280">Estimate Range</td>
                    <td style="padding:8px 0;font-weight:600;font-size:1.2em">${low:,.0f} – ${high:,.0f}</td></tr>
              </table>
              <a href="{link}" style="display:inline-block;margin-top:20px;padding:12px 24px;
                background:#1d4ed8;color:white;text-decoration:none;border-radius:6px;font-weight:600">
                Review & Approve Estimate
              </a>
            </div>
            """,
        })
        logger.info(f"Email sent to owner for estimate {estimate_id}")
        return True
    except Exception as e:
        logger.error(f"Email failed: {e}")
        return False


def notify_owner(estimate: dict, lead: dict) -> None:
    """Fire-and-forget: send SMS + email to owner."""
    send_sms_to_owner(estimate, lead)
    send_email_to_owner(estimate, lead)


def send_booking_confirmation_to_customer(
    to_email: str,
    customer_name: str,
    tier_label: str,
    tier_price: float,
    color_display: str,
    date_str: str,
    address: str,
    backup_dates: list[str] | None = None,
    is_hoa_approval_needed: bool = False,
    hoa_color_mode: str = "hoa_only",
    hoa_color_options: list[str] | None = None,
    wood_details: str = "",
    deposit_amount: float = 50.0,
) -> bool:
    settings = get_settings()
    if not settings.resend_api_key:
        logger.warning("Resend not configured — skipping customer confirmation email")
        return False

    try:
        import resend
        resend.api_key = settings.resend_api_key

        first_name = customer_name.split()[0] if customer_name else "there"
        parsed_backup_dates: list[str] = []
        for backup_date in (backup_dates or []):
            try:
                parsed_backup_dates.append(
                    datetime.fromisoformat(f"{backup_date}T12:00:00").strftime("%A, %B %-d, %Y")
                )
            except ValueError:
                continue

        deposit_html = f"""
              <tr>
                <td style="padding:8px 0;color:#9A9080;font-size:13px">Deposit Paid</td>
                <td style="padding:8px 0;font-weight:600;font-size:13px;text-align:right;color:#22c55e">${deposit_amount:,.2f}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#9A9080;font-size:13px">Remaining Balance</td>
                <td style="padding:8px 0;font-weight:600;font-size:13px;text-align:right">${max(tier_price - deposit_amount, 0):,.2f} <span style="font-weight:400;color:#9A9080;font-size:11px">(due day of service)</span></td>
              </tr>
        """

        hoa_options_html = ""
        if hoa_color_options:
            hoa_options_html = "".join(
                f"<li style=\"margin:4px 0\">{option}</li>" for option in hoa_color_options
            )

        hoa_section_html = ""
        if is_hoa_approval_needed:
            wood_lines = [line.strip() for line in (wood_details or "").split("\n") if line.strip()]
            wood_html = "".join(
                f'<p style="font-size:12px;color:#F5EDE0;line-height:1.7;margin:0 0 4px 0">{line}</p>'
                for line in wood_lines
            ) or '<p style="font-size:12px;color:#F5EDE0">Wood prep and stain details will be provided before service.</p>'

            already_approved = hoa_color_mode == "hoa_approved"
            intro_text = (
                "Your HOA approval is already confirmed. The details below are for your records."
                if already_approved
                else "You selected <strong>Needs HOA approval</strong>. You can forward this email directly to your HOA board."
            )
            color_line = (
                f"The approved stain color is: <strong>{color_display}</strong>."
                if already_approved
                else (f"Our requested color options are listed below." if hoa_color_options else f"The requested color is: <strong>{color_display}</strong>.")
            )
            hoa_section_html = f"""
              <div style="background:#1A1814;border-radius:10px;padding:18px;margin:20px 0;border:1px solid rgba(212,166,74,0.2)">
                <p style="font-size:14px;color:#D4A64A;font-weight:700;margin:0 0 8px 0">HOA Approval Support</p>
                <p style="font-size:12px;color:#9A9080;line-height:1.7;margin:0 0 10px 0">{intro_text}</p>
                {wood_html}
                {f'<p style="font-size:12px;color:#9A9080;margin:8px 0 4px 0">Color options submitted:</p><ul style="color:#F5EDE0;font-size:12px;padding-left:18px;margin:0">{hoa_options_html}</ul>' if hoa_options_html else ''}

                <div style="background:#0F0E0C;border-radius:8px;padding:14px;margin:14px 0 0 0;border:1px solid rgba(212,166,74,0.3)">
                  <p style="font-size:11px;color:#9A9080;margin:0 0 8px 0;text-transform:uppercase;letter-spacing:0.05em">Suggested HOA Letter Text</p>
                  <p style="font-size:12px;color:#F5EDE0;line-height:1.8;margin:0">
                    Dear HOA Board,<br/>
                    I am requesting approval to have my fence professionally stained at <strong>{address}</strong>.
                    The contractor, A&amp;T's Pressure Washing &amp; Fence Restoration, will apply
                    <strong>Ready Seal Exterior Stain &amp; Sealer</strong> to all wood surfaces.
                    {color_line}
                    The product is semi-transparent, water-based, and enhances the natural wood grain
                    while providing weather protection — it does not dramatically change the fence appearance.
                    Work is scheduled for <strong>{date_str}</strong>.
                    Please let me know if you need any additional information or documentation.
                  </p>
                </div>
              </div>
            """

        backup_dates_html = ""
        if parsed_backup_dates:
            backup_dates_html = """
              <tr>
                <td style="padding:8px 0;color:#9A9080;font-size:13px">Backup Dates</td>
                <td style="padding:8px 0;font-weight:600;font-size:13px;text-align:right">%s</td>
              </tr>
            """ % "<br/>".join(parsed_backup_dates)

        resend.Emails.send({
            "from": "A&T's Fence Restoration <noreply@atpressurewash.com>",
            "to": to_email,
            "subject": f"Your Fence Restoration is Booked — {date_str}",
            "html": f"""
            <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0F0E0C;color:#F5EDE0;padding:32px 24px;border-radius:12px">
              <h1 style="font-size:24px;font-weight:700;color:#D4A64A;margin-bottom:4px">You're all set, {first_name}!</h1>
              <p style="color:#9A9080;font-size:14px;margin-top:0">Your fence restoration has been confirmed.</p>

              <div style="background:#1A1814;border-radius:10px;padding:20px;margin:24px 0;border:1px solid rgba(212,166,74,0.15)">
                <table style="width:100%;border-collapse:collapse">
                  <tr>
                    <td style="padding:8px 0;color:#9A9080;font-size:13px">Package</td>
                    <td style="padding:8px 0;font-weight:600;font-size:13px;text-align:right">{tier_label}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#9A9080;font-size:13px">Price</td>
                    <td style="padding:8px 0;font-weight:600;font-size:13px;text-align:right">${tier_price:,.2f}</td>
                  </tr>
                  {deposit_html}
                  <tr>
                    <td style="padding:8px 0;color:#9A9080;font-size:13px">Color</td>
                    <td style="padding:8px 0;font-weight:600;font-size:13px;text-align:right">{color_display}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#9A9080;font-size:13px">Date</td>
                    <td style="padding:8px 0;font-weight:600;font-size:13px;text-align:right;color:#D4A64A">{date_str}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;color:#9A9080;font-size:13px">Address</td>
                    <td style="padding:8px 0;font-weight:600;font-size:13px;text-align:right">{address}</td>
                  </tr>
                  {backup_dates_html}
                </table>
              </div>

              {hoa_section_html}

              <p style="font-size:13px;color:#9A9080;border-left:3px solid #D4A64A;padding-left:12px;margin-bottom:24px">
                Dates may shift due to weather at no charge. We'll always notify you in advance.
              </p>

              <p style="font-size:14px;color:#F5EDE0;font-weight:600;margin-bottom:8px">What happens next:</p>
              <ol style="color:#9A9080;font-size:13px;padding-left:18px;line-height:1.8">
                <li>We'll send you a reminder text before your date</li>
                <li>We'll confirm the exact arrival window (typically 9am&ndash;1pm)</li>
                <li>Your crew arrives with your chosen color ready to go</li>
              </ol>

              <div style="margin-top:28px;padding-top:20px;border-top:1px solid rgba(212,166,74,0.15)">
                <p style="color:#9A9080;font-size:12px;margin:0">Questions? Call or text us:</p>
                <p style="color:#D4A64A;font-size:18px;font-weight:700;margin:4px 0">(832) 334-6528</p>
                <p style="color:#9A9080;font-size:11px;margin:0">A&amp;T's Pressure Washing &middot; Houston, TX</p>
              </div>
            </div>
            """,
        })
        logger.info(f"Booking confirmation email sent to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Customer confirmation email failed: {e}")
        return False
