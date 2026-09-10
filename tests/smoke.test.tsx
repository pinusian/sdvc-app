import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

function Hello() {
  return <h1>SDVC</h1>;
}

describe("[P2-1] 테스트 도구 스모크 테스트", () => {
  it("Vitest + React Testing Library가 정상 동작한다", () => {
    render(<Hello />);
    expect(screen.getByText("SDVC")).toBeInTheDocument();
  });
});
