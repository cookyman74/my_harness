const regex = /^export\s+default\b/m;
console.log(regex.test("export default Foo;"));
console.log(regex.test("  export default Foo;"));
console.log(regex.test("export  default  Foo;"));
