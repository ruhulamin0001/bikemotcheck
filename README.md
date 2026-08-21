# Bike MOT Check UK

Free MOT history checker for any UK registration, built on the official DVSA MOT History API.

**Live: https://bikemotcheckuk.cloud**

No sign up, no payment, and the registrations you look up are not stored.

## What it does

- Full MOT history for any vehicle registered in England, Scotland or Wales, back to 2005
- Every test, every mileage reading, every advisory and every failure with its defect category
- An **automatic buyer report** that flags the things worth asking a seller about:
  - mileage that goes backwards between tests, a possible clocking indicator
  - average annual mileage against the UK benchmark, 7,100 miles for cars and 3,000 for motorcycles
  - pass rate against the national average of 78.3%
  - dangerous defects, recurring fault themes, and long gaps between tests
- An SVG mileage-over-time chart, with rollback points drawn in red
- Side by side comparison of two vehicles at `/compare`
- MOT expiry countdown and a downloadable `.ics` calendar reminder
- Shareable permalinks at `/check/REG`

## Guides

Plain English, sourced from GOV.UK and DVSA:

- [UK MOT statistics 2026](https://bikemotcheckuk.cloud/guides/mot-statistics-uk)
- [What actually fails an MOT](https://bikemotcheckuk.cloud/guides/what-fails-an-mot-uk)
- [How to spot a clocked car](https://bikemotcheckuk.cloud/guides/spot-a-clocked-car-uk)
- [MOT rules and fines](https://bikemotcheckuk.cloud/guides/mot-rules-fines-uk)
- [Dangerous, major, minor and advisory explained](https://bikemotcheckuk.cloud/guides/mot-defect-categories-uk)

## How it is built

Node 20, **zero dependencies**.

| File | Role |
|---|---|
| `server.js` | HTTP server, DVSA OAuth2 token cache, result cache, rate limiting, HTML shell |
| `client.js` | All browser code: analysis engine, chart, compare. Served at `/app.js` |
| `guides.js` | The guides service, a separate container behind a Traefik path prefix |

The DVSA API uses OAuth2 client credentials, so the secret cannot live in the browser. That is
why there is a server side component at all. **No credentials are in this repository.** They are
supplied as environment variables at runtime.

### Endpoints

```
GET /                     the checker
GET /check/:reg           permalink for a registration
GET /compare?a=&b=        side by side comparison
GET /api/mot?reg=         JSON, rate limited
GET /calendar/:reg.ics    MOT expiry reminder with 21 and 7 day alarms
GET /healthz              liveness
```

### Being a good API citizen

- OAuth token cached in memory, refreshed 5 minutes before expiry, single flight
- Vehicle lookups cached 6 hours so repeated searches never touch the quota
- 120ms global pacing to respect the DVSA burst limit
- 40 lookups per IP per hour

## Data and licence

MOT data comes from the [DVSA MOT History API](https://documentation.history.mot.api.gov.uk/).
DVSA statistics quoted in the guides are published under the Open Government Licence v3.0.

Coverage is England, Scotland and Wales. Northern Ireland MOTs are administered by the DVA and
are not in this dataset.

An MOT is a roadworthiness snapshot on the day of the test. It is not a mechanical warranty, and
it says nothing about outstanding finance, theft markers or write off categories.

## Author

Built by Ruhul Amin, Hertfordshire.
