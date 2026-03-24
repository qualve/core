# @qualve/graphql

GraphQL inputs for Qualve Tasks.

## Installation

```sh
npm install @qualve/graphql
```

## Usage

In your `qualve.config.js`, import the `graphql` task:

```js
import "@qualve/graphql";

export default {
	graphql: {
		endpoint: "https://api.example.com/graphql",
	},
	model: {
		// ...
	},
};
```
