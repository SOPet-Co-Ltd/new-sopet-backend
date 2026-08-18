# Sopet Incident Response Runbook

This runbook outlines the standard operating procedures for responding to security incidents within the Sopet E-commerce platform.

## 1. Incident Classification

| Severity             | Description                                                                                      | Examples                                                                              | Target Response Time |
| -------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------- |
| **SEV-1 (Critical)** | Core system compromise, active data breach, widespread outage due to attack.                     | Database compromise, mass account takeover, Omise credential leak.                    | 15 minutes           |
| **SEV-2 (High)**     | Localized compromise, partial service disruption, unauthorized access to a single admin account. | Targeted DDoS, unauthorized access by a single vendor, suspected data exfiltration.   | 1 hour               |
| **SEV-3 (Medium)**   | Suspicious activity, automated probing, isolated vulnerability discovery without exploitation.   | High rate of failed logins, XSS vulnerability report, WAF blocking large scale scans. | 4 hours              |
| **SEV-4 (Low)**      | Informational alerts, policy violations with no direct impact.                                   | Phishing attempt reported by user, non-critical misconfiguration.                     | 24 hours             |

## 2. Response Phases

### Phase 1: Preparation & Detection

- Monitor Datadog/CloudWatch for anomalous traffic or error rates (e.g., HTTP 429 Too Many Requests, HTTP 500).
- Monitor Cloudflare WAF alerts for blocked attacks.
- Review SIEM logs for suspicious access patterns (e.g., cross-tenant data access attempts).

### Phase 2: Containment (Immediate Action)

- **Account Compromise:** Immediately revoke the user's/vendor's JWT sessions and reset their password.
- **DDoS/Bot Attack:** Adjust Cloudflare WAF rules to challenge or block the offending ASNs or IP ranges. Enable "I'm Under Attack" mode if necessary.
- **Service Compromise:** Isolate the affected container or instance from the network. Do NOT terminate the instance if forensic evidence is needed, but disconnect its external access.
- **Credential Leak:** If API keys (e.g., Omise) are suspected to be leaked, rotate them immediately via the Omise Dashboard and update the environment variables.

### Phase 3: Eradication

- Identify the root cause of the incident (e.g., vulnerable dependency, misconfigured IAM role, leaked password).
- Patch the vulnerability or correct the misconfiguration.
- Remove any malicious artifacts (e.g., backdoors, unauthorized SSH keys) left by the attacker.
- Deploy the updated code or configuration to the staging environment for verification before pushing to production.

### Phase 4: Recovery

- Restore services from known good backups if data was altered or destroyed.
- Gradually restore traffic to the affected service while closely monitoring logs and metrics for any signs of returning malicious activity.
- Verify that the system is fully functional and secure.

### Phase 5: Post-Incident Activity (Lessons Learned)

- Within 48 hours of resolving a SEV-1 or SEV-2 incident, conduct a blameless post-mortem meeting.
- Document the timeline of events, root cause, containment actions, and areas for improvement.
- Update this runbook, alerting rules, and security controls based on the findings.

## 3. Specific Playbooks

### Playbook A: Suspected Data Breach (PDPA Focus)

1. **Verify:** Confirm that personal data (PII) was actually accessed or exfiltrated.
2. **Contain:** Lock down the affected database or API endpoint.
3. **Assess:** Determine the scope of the breach (number of users, types of data).
4. **Notify:** If the breach poses a risk to user rights and freedoms, trigger the **PDPA Breach Notification Process** (refer to \`dsr-and-breach-process-policy.md\`). Must notify the PDPC within 72 hours.
5. **Remediate:** Patch the vulnerability and monitor for further unauthorized access.

### Playbook B: Payment Fraud / Card Testing

1. **Detect:** High rate of failed transactions or small authorizations via Omise.
2. **Contain:** Temporarily block the offending IP addresses or user accounts.
3. **Mitigate:** Enable aggressive bot protection in Cloudflare. Adjust rate limits for payment endpoints.
4. **Review:** Contact Omise support if the attack persists. Review transaction logs for any successful fraudulent charges and initiate refunds/chargebacks as necessary.
