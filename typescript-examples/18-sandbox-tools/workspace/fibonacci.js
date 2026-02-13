// Compute and print the first 10 Fibonacci numbers
function fibonacci(n) {
    const fib = [];
    for (let i = 0; i < n; i++) {
        if (i === 0) {
            fib.push(0);
        } else if (i === 1) {
            fib.push(1);
        } else {
            fib.push(fib[i - 1] + fib[i - 2]);
        }
    }
    return fib;
}

const fibNumbers = fibonacci(10);
console.log("First 10 Fibonacci numbers:");
console.log(fibNumbers.join(", "));
