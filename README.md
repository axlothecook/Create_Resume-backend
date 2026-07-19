# Resume Creator Backend
The API of Resume Creator, built with Express and MongoDB. It handles everything related to user accounts and the saved resumes for the frontend; everything else about building a resume happens in the browser.

## What it does
<ul> 
	<li>accounts: sign up, log in and log out, with passwords hashed before storing</li> 
	<li>sessions: logging in lasts 7 days, or 30 <b>with</b> `remember me` option ticked on</li> 
	<li>saved resumes: CRUD with a limit of 5 per account, stored as JSON documents</li> 
	<li>request validation with express-validator</li> 
</ul>


## The login cookie story
The session rides in an httpOnly cookie. Originally the API lived on its own subdomain, which made the cookie cross-site, and strict browsers like Safari, Firefox and Brave dropped it, which resulted in login failing on phones. The fix was moving everything to one domain, where nginx serves the app and proxies `/api` to this backend. The cookie is now first-party (`SameSite=Lax`) and works everywhere.

## Why no graph here
The backend's place in the system is already drawn twice: the [frontend README](https://github.com/axlothecook/Create_Resume/blob/main/README.md) shows what stays in the browser and what travels to the API, and the [umbrella README](https://github.com/axlothecook/Create_Resume-umbrella/blob/main/README.md) shows how the repos connect. A third graph would just repeat those two.

## Testing
The auth and resume endpoints are covered by 25 tests. The tests create a temporary MongoDB that lives only while they run and gets thrown away after, so they don't need a real database. They run in CI before every deploy; if any fail, nothing gets deployed. The pipeline itself is explained in [homelab-ci-cd](https://github.com/axlothecook/homelab-ci-cd).

## Tech stack
[Node.js](https://nodejs.org) / [Express 5](https://expressjs.com): Node runs the server, Express handles the incoming requests and the middleware <br />
[MongoDB](https://www.mongodb.com) with [Mongoose](https://mongoosejs.com): stores users' data and their resumes as documents <br />
[Passport](https://www.passportjs.org): handles the password login, checked against my own database <br />
[express-session](https://github.com/expressjs/session) and [connect-mongo](https://github.com/jdesboeufs/connect-mongo): server-side sessions stored in MongoDB <br />
[bcryptjs](https://github.com/dcodeIO/bcrypt.js): password hashing <br />
[express-validator](https://express-validator.github.io): validates and sanitizes request input <br />
[Jest](https://jestjs.io), [supertest](https://github.com/ladjs/supertest) and [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server): the test setup
