user chooses ticketing system
user chooses knowledge base/folder to start with. system chunks it language aware, embedds it, throws it in vector db. 

user specifies types of tickets to action, types of tickets to not action

user chooses actions to be performed with said tickets.  download? store data from the ticket into variables? query for more data?
system browses to ticket, handles authentication, scrapes ticket, queries for needed data
chunks or embeds scraped metadata and queries against existing issues in vector database that might match ticket description
generates prompt for llm
comes up with a plan, suggests action: some automated steps or manual steps
updates the ticket with discovered challenges.