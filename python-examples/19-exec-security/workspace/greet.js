// Import chalk for colored output
import chalk from 'chalk';

// Get the name argument from command line
const name = process.argv[2];

// Check if name was provided
if (!name) {
  console.log(chalk.red('Please provide a name as an argument!'));
  console.log(chalk.yellow('Usage: node greet.js <name>'));
  process.exit(1);
}

// Print the greeting in color
console.log(chalk.green.bold(`Hello, ${name}!`) + chalk.cyan(' Welcome!'));
