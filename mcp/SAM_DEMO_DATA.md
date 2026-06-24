# SAM Pro demonstration data

The ServiceNow dashboard uses a PDI-only demonstration layer when:

- the selected instance profile is `pdi`; and
- native `samp_license_metric_result` and `samp_publisher_result` records are unavailable.

Live PDI data remains the source for entitlements, software models, entitlement value, and publisher license counts. The following values are simulated and visibly labelled as demo data:

| Publisher | Rights owned | Rights used | Rights short | Rights available | True-up exposure |
| --- | ---: | ---: | ---: | ---: | ---: |
| Microsoft | 370 | 320 | 0 | 50 | $0 |
| Adobe Systems | 600 | 720 | 120 | 0 | $21,600 |
| IBM | 100,000 | 65,000 | 0 | 35,000 | $0 |
| Citrix Systems | 630 | 700 | 70 | 0 | $35,000 |

The simulated inventory contains 66,740 installations across four discovery models. Adobe Systems and Citrix Systems are intentionally non-compliant so the report demonstrates true-up exposure and compliance exceptions.

The work-instance profile never uses this fallback. Native reconciliation results also take precedence automatically if they become available on the PDI.

To remove the demonstration layer, delete `samDemoMetricResults` and `samDemoPublisherResults` from `server/index.js` and remove the `demoData` fallback condition in the SAM endpoint.
