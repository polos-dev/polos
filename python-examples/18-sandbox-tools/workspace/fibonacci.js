// Compute and print the first 10 Fibonacci numbers
function fibonacci(n) {
    const fib = [];
    for (let i = 0; i < n; i++) {
        if (i === 0 || i === 1) {
            fib.push(i);
        } else {
            fib.push(fib[i - 1] + fib[i - 2]);
        }
    }
    return fib;
}

const firstTen = fibonacci(10);
console.log("First 10 Fibonacci numbers:");
console.log(firstTen.join(", "));
