# Resume Creator Backend
The API of Resume Creator, built with Express and MongoDB. It handles everything related to user accounts and the saved resumes for the frontend; everything else about building a resume happens in the browser.

## What it does
<ul> 
	<li>accounts: sign up, log in and log out, with passwords hashed before storing</li> 
	<li>sessions: logging in lasts 7 days, or 30 <b>with</b> `remember me` option ticked on</li> 
	<li>saved resumes: CRUD with a limit of 5 per account, stored as JSON documents</li> 
	<li>password recovery: emailed reset link, valid 15 minutes and usable once</li> 
	<li>rate limiting on the auth routes, per IP and per email address</li> 
	<li>request validation with express-validator</li> 
</ul>


## The login cookie story
The session rides in an httpOnly cookie. Originally the API lived on its own subdomain, which made the cookie cross-site, and strict browsers like Safari, Firefox and Brave dropped it, which resulted in login failing on phones. The fix was moving everything to one domain, where nginx serves the app and proxies `/api` to this backend. The cookie is now first-party (`SameSite=Lax`) and works everywhere.

## Why no graph here
The backend's place in the system is already drawn twice: the [frontend README](https://github.com/axlothecook/Create_Resume/blob/main/README.md) shows what stays in the browser and what travels to the API, and the [umbrella README](https://github.com/axlothecook/Create_Resume-umbrella/blob/main/README.md) shows how the repos connect. A third graph would just repeat those two.

## How a forgotten password gets reset
Asking for a reset always answers the same way, whether or not the address has an account, and the work happens after the reply is sent so the response time gives nothing away either. What lands in the database is only a SHA-256 of the token, so a copy of the database cannot be turned into a working reset link. The link expires after 15 minutes and stops working the moment it is used. Changing the password also signs out every other device: each session carries a stamp of the password it was issued under, and a stamp that no longer matches gets thrown out on its next request. The URL in the email is built from configuration rather than the request headers, so it cannot be pointed somewhere else by a forged `Host` header.

## Testing
The auth and resume endpoints are covered by 67 tests. The tests create a temporary MongoDB that lives only while they run and gets thrown away after, so they don't need a real database. They run in CI before every deploy; if any fail, nothing gets deployed. The pipeline itself is explained in [homelab-ci-cd](https://github.com/axlothecook/homelab-ci-cd).

## Tech stack
[Node.js](https://nodejs.org) / [Express 5](https://expressjs.com): Node runs the server, Express handles the incoming requests and the middleware <br />
[MongoDB](https://www.mongodb.com) with [Mongoose](https://mongoosejs.com): stores users' data and their resumes as documents <br />
[Passport](https://www.passportjs.org): handles the password login, checked against my own database <br />
[express-session](https://github.com/expressjs/session) and [connect-mongo](https://github.com/jdesboeufs/connect-mongo): server-side sessions stored in MongoDB <br />
[bcryptjs](https://github.com/dcodeIO/bcrypt.js): password hashing <br />
[express-validator](https://express-validator.github.io): validates and sanitizes request input <br />
[express-rate-limit](https://github.com/express-rate-limit/express-rate-limit): caps how often the auth routes can be hit, per IP and per email <br />
[Brevo](https://www.brevo.com): sends the password reset email. With no API key set it prints the email to the console instead, so the whole flow still works in development <br />
[Jest](https://jestjs.io), [supertest](https://github.com/ladjs/supertest) and [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server): the test setup
