// Compute and print the first 10 Fibonacci numbers
function fibonacci(n) {
    const fibs = [];
    for (let i = 0; i < n; i++) {
        if (i === 0 || i === 1) {
            fibs.push(i);
        } else {
            fibs.push(fibs[i - 1] + fibs[i - 2]);
        }
    }
    return fibs;
}

const first10 = fibonacci(10);
console.log("First 10 Fibonacci numbers:");
console.log(first10.join(", "));
