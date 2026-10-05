# Probe All You Want: the script

From the Report's "Probe all you want, there's no compute here..."
(4 Sep 2026), and what it cites: Unit 42's extortion analysis, GreyNoise's
2026 State of the Edge report, "Certifiably Vulnerable" (EuroS&P 2023) and
W3Techs.

The place is a street at night, in fog (STYLE.md, "find the world"). A
full-stack shop has everything out: a wp-admin front door, a key under the
mat, a shed, a cellar, a mail slot, a chimney. Our site is a new house that
is only a house front: one printed sheet standing on the pavement, its door
cut into the paper. Beside it, a counter where the CDN hands every caller
the same printed slip, "not here". The
protection isn't a wall. It's that there's nothing behind the page to grab.

Grammar as in README.md. Each beat's first direction names the STYLE.md
move it uses.

## 00 The log

> Move: the receipt. Cold open, no title. A new house unfolds out of the page, alone in the fog. Its door opens. Then the bots come out of the fog to the door, a tally counting them in.

> ♪ hush

{log} The morning we launched this site, nobody knew it existed. {fifty} Within minutes, there were 50 bots were at the door.

## 01 Title

{title}

## 02 The notice board

> Move: the case. The street unfolds out of the page in fog: the shop, our house, and a notice board in the middle of the street. Our page is pinned to it. Bots come out of the fog to read it.

> ♪ fog 1

{street} Modern websites need secure certs so {cert} we requested (and got) a TLS certificate.

{board} Every public certificate is posted to a Certificate Transparency log. {readers} Anyone can see the host just by watching the log.

{seconds} Researchers have consistently seen probes arrive seconds after a new cert appeared.

## 03 Every door on the street

> Move: the case, following one bot. It reads the board, crosses to the shop, and tries every door it has, while its crowd works the rest.

> ♪ knock 1

{follow} Then the probing starts. {wpadmin} Is this WordPress? Where's the admin page?

{mat} Is there a .env file? A .env.bak? {shed} Is .git/config lying around?

{slot} Got an old mailer.cgi? It's 2026, but somebody still runs it.

{old} Bugs from before 2015 draw 4 times the exploit traffic of new bugs.

{dictionary} It's not a threat model. It's a dictionary. And the bots check that list on your site it a few hundred times a day.

## 04 The whole city

> Move: pull back. Up through the fog over a city of folded streets, every one with its crowd.

> ♪ city 1.5

{city} GreyNoise watched sensors in more than 80 countries. {sessions} In 162 days: almost 3 billion malicious sessions, {ips} from 3.8 million computer addresses.

{la} That's like having everyone in Los Angeles crawling your web app.

{unseen} Over half the code-execution attempts came from addresses nobody had seen before, so you can't just block them.

## 05 What they're after

> Move: the case, at the shop. One bot lifts the mat: the .env, a username and a password in it (illustrative). The camera swings round the lot: the bots carry the keys in and build new houses inside the shop's own fence, and those houses spew bots that swarm the neighbours.

> ♪ take 1

{key} In 2024, Unit 42 traced one crew that found .env files on 110,000 domains. {keys} Inside those files were 7,000 cloud access keys.

{lambdas} With those keys, the bots made Lambda functions in the victims' own accounts, {next} and made more bots to run the next round of scanning from there, all on the victims' bill.

{mining} It mined crypto. {ransom} It emptied data stores and it left ransom notes.

> ♪ silence 2

{prize} The prize for finding your .env file wasn't your data. It was your compute.

## 06 The fair hearing

> Move: the fair hearing. A burst of probes floods the street; the shop unfolds copy after copy to meet it, and folds them away when it passes. The same burst reaches our counter and gets slips; nothing unfolds. Then a host's tent folds over the shop: every door still under it, one rope holding it shut.

> ♪ hearing 2

{scale} Even when they steal nothing, a full stack pays to be scanned. {eight} We once watched a WordPress stack go from 1 small instance to 8 big ones, scaling up and down all the time in response to bursts of probes.

{burst} A flat site takes the same burst and adds nothing.

{host} Having a hosted platform helps: someone else patches it. {tent} But nothing got subtracted. {rope} The stack moved where you can't see it, behind one account credential.

## 07 The turn

> Move: the turn. Back to our house. One bot reaches through the printed door. The camera comes round the side: its hand comes out the back into fog and closes on nothing. Hold.

> ♪ turn 2

{turn} The CDN isn't a wall. {nothing} There's just nothing behind the page to grab.

[pause 1.5]

## 08 The other side of the ledger

> Move: the ledger read backwards. The counter hands every caller the same printed slip. Their receipt runs long and red; ours barely moves.

> ♪ ledger 1.5

{slips} Every probe gets the same cached answer: move along... that file isn't here. {cost} In Flat-Stack, that barely a rounding error.

## 09 The same night, emptied

> Move: rebuild it flat, the rhyme. Rewind the night. The shop folds down into the page, its doors left as dashed outlines. Our side: the page and a box of finished files. Seen side-on, it's flat: nothing running behind it.

> ♪ flat 2

{rewind} Here's the same burst of probes at our web site. {files} The site is files. The templates ran yesterday; you can't inject code into a finished page.

{storage} It's flat storage. There's no compute for the bots to see.

{missing} No .env, no .git, no wp-config. {shape} They're missing because of the build's shape, not because we remembered to hide them.

## 10 The honest part

> Move: the honest caveat. Down a lane off the street, behind a big stone wall with one gate, a small shed folded flat on the page. The gate slides open for the editor's key; the shed unfolds, then folds flat again, and the gate shuts.

> ♪ shed 1.5

{lane} There is compute here. {editor} The editor that published this page is a Lambda, {asleep} asleep behind a different door the probes never find.

{notzero} Flat isn't zero. It's nothing left out that doesn't need to be.

## 11 The line

> Move: the line, and stillness. Our house, its door open; callers wander in, read, get their slip and go out the back. The shop next door is flat paper. Then the line, held.

> ♪ end 2

{weather} You're going to get scanned. Bots are going to show up at your open house.

{open} But, you can still have that open house: the door's open, and anyone can come in and read.

[pause 0.6]

{end} You just don't have to give your guests the keys to everything.
